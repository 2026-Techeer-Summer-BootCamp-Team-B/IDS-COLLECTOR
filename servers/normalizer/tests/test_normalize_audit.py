"""normalize_audit() + K8s Audit request-body 헬퍼(_audit_role_rule_flags 등)
단위 테스트. severity.yaml 실제 규칙까지 그대로 태워서 RBAC/파드보안/시크릿류
심각도 오분류를 원본 배포 규칙 기준으로 잡는다."""
import json

from app.normalizer import (
    _audit_configmap_has_credentials,
    _audit_ingress_has_tls,
    _audit_request_objects,
    _audit_role_rule_flags,
    normalize_audit,
)


class TestAuditRequestObjects:
    def test_single_dict_wrapped_in_list(self):
        assert _audit_request_objects({"requestObject": {"a": 1}}) == [{"a": 1}]

    def test_json_patch_array_keeps_only_dict_elements(self):
        # kubectl patch --type=json 요청은 body 자체가 JSON Patch 연산 배열이라
        # dict가 아니다 - 문자열 등 dict가 아닌 원소만 조용히 걸러내야 한다
        # (2026-07-15 이전엔 이 경우 AttributeError로 이벤트 전체가 DLQ行이었음).
        payload = {"requestObject": [{"a": 1}, "not-a-dict", {"b": 2}]}
        assert _audit_request_objects(payload) == [{"a": 1}, {"b": 2}]

    def test_missing_request_object_returns_empty_list(self):
        assert _audit_request_objects({}) == []

    def test_non_dict_non_list_request_object_returns_empty_list(self):
        assert _audit_request_objects({"requestObject": "unexpected"}) == []


class TestAuditRoleRuleFlags:
    def test_wildcard_resource_flagged(self):
        payload = {"requestObject": {"rules": [{"resources": ["*"], "verbs": ["get"]}]}}
        assert _audit_role_rule_flags(payload) == ["wildcard_resource"]

    def test_wildcard_verb_flagged(self):
        payload = {"requestObject": {"rules": [{"resources": ["pods"], "verbs": ["*"]}]}}
        assert _audit_role_rule_flags(payload) == ["wildcard_verb"]

    def test_write_verb_flagged(self):
        payload = {"requestObject": {"rules": [{"resources": ["pods"], "verbs": ["create"]}]}}
        assert _audit_role_rule_flags(payload) == ["write_verb"]

    def test_pods_exec_flagged_alongside_write_verb(self):
        payload = {"requestObject": {"rules": [{"resources": ["pods/exec"], "verbs": ["create"]}]}}
        assert _audit_role_rule_flags(payload) == ["pods_exec", "write_verb"]

    def test_read_only_rule_has_no_flags(self):
        payload = {"requestObject": {"rules": [{"resources": ["pods"], "verbs": ["get"]}]}}
        assert _audit_role_rule_flags(payload) is None

    def test_json_patch_array_unions_flags_across_elements(self):
        payload = {
            "requestObject": [
                {"rules": [{"resources": ["*"], "verbs": ["get"]}]},
                {"rules": [{"resources": ["pods"], "verbs": ["delete"]}]},
            ]
        }
        assert _audit_role_rule_flags(payload) == ["wildcard_resource", "write_verb"]


class TestAuditConfigmapHasCredentials:
    def test_password_key_detected(self):
        payload = {"requestObject": {"data": {"db_password": "secret123"}}}
        assert _audit_configmap_has_credentials(payload) is True

    def test_aws_access_key_id_detected_in_binary_data(self):
        payload = {"requestObject": {"binaryData": {"aws_access_key_id": "QUJDRUZH"}}}
        assert _audit_configmap_has_credentials(payload) is True

    def test_benign_data_not_flagged(self):
        payload = {"requestObject": {"data": {"log_level": "debug", "replicas": "3"}}}
        assert _audit_configmap_has_credentials(payload) is None

    def test_key_value_boundary_does_not_falsely_concatenate(self):
        # 2026-07-15에 수정된 버그의 회귀 테스트: 키가 "...pass"로 끝나고 값이
        # "word..."로 시작해도, 공백으로 join하므로 "password"라는 글자가 우연히
        # 이어붙어 오탐되면 안 된다(구버전은 키/값 그룹을 구분자 없이 이어붙였다).
        payload = {"requestObject": {"data": {"retry_pass": "word_count_limit"}}}
        assert _audit_configmap_has_credentials(payload) is None


class TestAuditIngressHasTls:
    def test_tls_key_present_returns_true(self):
        assert _audit_ingress_has_tls({"requestObject": {"spec": {"tls": []}}}) is True

    def test_tls_key_absent_returns_false(self):
        assert _audit_ingress_has_tls({"requestObject": {"spec": {"rules": []}}}) is False

    def test_no_request_object_returns_none_not_false(self):
        # 판정 불가(요청 본문 없음)와 "TLS 명시적으로 없음"을 구분해야 오탐을 막는다.
        assert _audit_ingress_has_tls({}) is None


class TestNormalizeAuditEndToEnd:
    def test_rbac_change_gets_critical_severity(self, base_audit_event):
        payload = base_audit_event(
            verb="create",
            objectRef={"resource": "clusterroles", "name": "backdoor-role"},
            responseStatus={"code": 201},
        )
        event = normalize_audit(payload, "e1", "{}")
        assert event.event_module == "k8s_audit"
        assert event.event_dataset == "k8s_audit.audit"
        assert event.event_action == "create clusterroles"
        assert event.event_severity == 4
        assert event.event_outcome == "success"

    def test_pods_exec_gets_high_severity_and_action_includes_subresource(self, base_audit_event):
        payload = base_audit_event(
            verb="get",
            objectRef={
                "resource": "pods", "subresource": "exec",
                "namespace": "default", "name": "victim-pod",
            },
        )
        event = normalize_audit(payload, "e2", "{}")
        assert event.event_action == "get pods/exec"
        assert event.event_severity == 3
        assert event.orchestrator_resource_subresource == "exec"

    def test_subresource_absent_is_none_and_excluded_from_serialized_json(self, base_audit_event):
        payload = base_audit_event(
            verb="create",
            objectRef={"resource": "pods", "namespace": "default", "name": "plain-pod"},
            responseStatus={"code": 201},
        )
        event = normalize_audit(payload, "e25", "{}")
        assert event.orchestrator_resource_subresource is None
        serialized = json.loads(event.model_dump_json(by_alias=True, exclude_none=True))
        assert "orchestrator.resource.subresource" not in serialized

    def test_subresource_present_is_included_in_serialized_json(self, base_audit_event):
        payload = base_audit_event(
            verb="get",
            objectRef={"resource": "pods", "subresource": "exec", "namespace": "default", "name": "victim-pod"},
        )
        event = normalize_audit(payload, "e26", "{}")
        serialized = json.loads(event.model_dump_json(by_alias=True, exclude_none=True))
        assert serialized["orchestrator.resource.subresource"] == "exec"

    def test_pods_exec_severity_is_high_regardless_of_verb(self, base_audit_event):
        # severity.yaml의 pods/exec 룰이 verb 열거에서 subresource 단독 조건으로
        # 전환됐으므로(2026-07-20), create/get뿐 아니라 임의의 다른 verb로 기록돼도
        # severity=3이어야 한다 - event.action 문자열 합성 로직(verb+resource_full)은
        # 이 전환과 무관하게 그대로여야 하므로 함께 회귀 검증한다.
        for verb in ["create", "get", "watch"]:
            payload = base_audit_event(
                verb=verb,
                objectRef={
                    "resource": "pods", "subresource": "exec",
                    "namespace": "default", "name": "victim-pod",
                },
            )
            event = normalize_audit(payload, f"e27-{verb}", "{}")
            assert event.event_severity == 3, f"verb={verb}"
            assert event.event_action == f"{verb} pods/exec"

    def test_serviceaccount_created_in_kube_system_is_critical(self, base_audit_event):
        payload = base_audit_event(
            verb="create",
            objectRef={"resource": "serviceaccounts", "namespace": "kube-system", "name": "backdoor-sa"},
            responseStatus={"code": 201},
        )
        event = normalize_audit(payload, "e3", "{}")
        assert event.event_severity == 4

    def test_serviceaccount_created_in_normal_namespace_is_not_elevated(self, base_audit_event):
        payload = base_audit_event(
            verb="create",
            objectRef={"resource": "serviceaccounts", "namespace": "default", "name": "app-sa"},
            responseStatus={"code": 201},
        )
        event = normalize_audit(payload, "e4", "{}")
        # serviceaccounts는 "워크로드 변경 맥락" 규칙(pods/deployments 한정)에도
        # 안 걸려서 default(2)로 폴백해야 한다.
        assert event.event_severity == 2

    def test_secrets_list_is_high_severity(self, base_audit_event):
        payload = base_audit_event(verb="list", objectRef={"resource": "secrets", "namespace": "default"})
        event = normalize_audit(payload, "e5", "{}")
        assert event.event_severity == 3

    def test_namespace_delete_is_critical(self, base_audit_event):
        payload = base_audit_event(
            verb="delete", objectRef={"resource": "namespaces", "name": "victim-ns"},
        )
        event = normalize_audit(payload, "e6", "{}")
        assert event.event_severity == 4

    def test_generic_read_is_low_severity(self, base_audit_event):
        payload = base_audit_event(verb="watch", objectRef={"resource": "configmaps"})
        event = normalize_audit(payload, "e7", "{}")
        assert event.event_severity == 1

    def test_privileged_pod_create_is_critical_via_request_body(self, base_audit_event):
        payload = base_audit_event(
            verb="create",
            objectRef={"resource": "pods", "namespace": "default", "name": "evil-pod"},
            responseStatus={"code": 201},
            requestObject={"spec": {"containers": [{"securityContext": {"privileged": True}}]}},
        )
        event = normalize_audit(payload, "e8", "{}")
        assert event.event_severity == 4
        assert event.audit_pod_security_flags == ["privileged"]

    def test_normal_pod_create_is_workload_context_severity(self, base_audit_event):
        payload = base_audit_event(
            verb="create",
            objectRef={"resource": "pods", "namespace": "default", "name": "normal-pod"},
            responseStatus={"code": 201},
            requestObject={"spec": {"containers": [{"securityContext": {}}]}},
        )
        event = normalize_audit(payload, "e9", "{}")
        assert event.event_severity == 2
        assert event.audit_pod_security_flags is None

    def test_pod_security_flags_only_computed_for_create_verb(self, base_audit_event):
        # verb != "create"면 request body를 아예 안 본다(호출부 분기) - update에
        # privileged spec이 와도 audit_pod_security_flags가 채워지면 안 된다.
        payload = base_audit_event(
            verb="update",
            objectRef={"resource": "pods", "namespace": "default", "name": "existing-pod"},
            requestObject={"spec": {"containers": [{"securityContext": {"privileged": True}}]}},
        )
        event = normalize_audit(payload, "e10", "{}")
        assert event.audit_pod_security_flags is None

    def test_nodeport_service_is_high_severity(self, base_audit_event):
        payload = base_audit_event(
            verb="create",
            objectRef={"resource": "services", "namespace": "default", "name": "exposed-svc"},
            responseStatus={"code": 201},
            requestObject={"spec": {"type": "NodePort"}},
        )
        event = normalize_audit(payload, "e11", "{}")
        assert event.event_severity == 3
        assert event.audit_service_type == ["NodePort"]

    def test_configmap_with_credentials_is_critical(self, base_audit_event):
        payload = base_audit_event(
            verb="create",
            objectRef={"resource": "configmaps", "namespace": "default", "name": "app-config"},
            responseStatus={"code": 201},
            requestObject={"data": {"db_password": "hunter2"}},
        )
        event = normalize_audit(payload, "e12", "{}")
        assert event.event_severity == 4
        assert event.audit_configmap_has_credentials is True

    def test_configmap_without_credentials_falls_to_default(self, base_audit_event):
        payload = base_audit_event(
            verb="create",
            objectRef={"resource": "configmaps", "namespace": "default", "name": "app-config"},
            responseStatus={"code": 201},
            requestObject={"data": {"log_level": "debug"}},
        )
        event = normalize_audit(payload, "e13", "{}")
        assert event.event_severity == 2
        assert event.audit_configmap_has_credentials is None

    def test_ingress_without_tls_is_high_severity(self, base_audit_event):
        payload = base_audit_event(
            verb="create",
            objectRef={"resource": "ingresses", "namespace": "default", "name": "public-ingress"},
            responseStatus={"code": 201},
            requestObject={"spec": {"rules": []}},
        )
        event = normalize_audit(payload, "e14", "{}")
        assert event.event_severity == 3
        assert event.audit_ingress_has_tls is False

    def test_ingress_with_tls_is_not_elevated(self, base_audit_event):
        payload = base_audit_event(
            verb="create",
            objectRef={"resource": "ingresses", "namespace": "default", "name": "public-ingress"},
            responseStatus={"code": 201},
            requestObject={"spec": {"tls": [{"secretName": "tls-secret"}]}},
        )
        event = normalize_audit(payload, "e15", "{}")
        assert event.event_severity == 2
        assert event.audit_ingress_has_tls is True

    def test_ingress_without_request_object_does_not_falsely_flag_no_tls(self, base_audit_event):
        # audit_ingress_has_tls=None(판정 불가)은 "ingress_has_tls: false" 규칙에
        # 안 걸려야 한다 - None을 False로 뭉개면 오탐.
        payload = base_audit_event(
            verb="create",
            objectRef={"resource": "ingresses", "namespace": "default", "name": "public-ingress"},
            responseStatus={"code": 201},
        )
        event = normalize_audit(payload, "e16", "{}")
        assert event.event_severity == 2
        assert event.audit_ingress_has_tls is None

    def test_role_rule_flags_only_computed_for_role_resources(self, base_audit_event):
        # pods 같은 리소스는 애초에 _audit_role_rule_flags를 호출하지도 않는다
        # (resource in RBAC_ROLE_RESOURCES 분기) - requestObject에 우연히 rules
        # 키가 있어도 무시돼야 한다.
        payload = base_audit_event(
            verb="create",
            objectRef={"resource": "pods", "namespace": "default", "name": "pod-with-rules-key"},
            responseStatus={"code": 201},
            requestObject={"rules": [{"resources": ["*"], "verbs": ["*"]}], "spec": {}},
        )
        event = normalize_audit(payload, "e17", "{}")
        assert event.audit_role_rule_flags is None

    def test_source_ip_uses_first_entry(self, base_audit_event):
        payload = base_audit_event(sourceIPs=["203.0.113.10", "10.0.0.1"])
        event = normalize_audit(payload, "e18", "{}")
        assert event.source_ip == "203.0.113.10"

    def test_no_source_ips_returns_none(self, base_audit_event):
        payload = base_audit_event(sourceIPs=[])
        event = normalize_audit(payload, "e19", "{}")
        assert event.source_ip is None

    def test_binding_role_name_for_clusterrolebinding(self, base_audit_event):
        payload = base_audit_event(
            verb="create",
            objectRef={"resource": "clusterrolebindings", "name": "backdoor-binding"},
            responseStatus={"code": 201},
            requestObject={"roleRef": {"kind": "ClusterRole", "name": "cluster-admin"}},
        )
        event = normalize_audit(payload, "e20", "{}")
        assert event.audit_binding_role_name == ["cluster-admin"]

    def test_binding_subject_for_single_subject(self, base_audit_event):
        payload = base_audit_event(
            verb="create",
            objectRef={"resource": "rolebindings", "namespace": "default", "name": "grant-a"},
            responseStatus={"code": 201},
            requestObject={
                "roleRef": {"kind": "Role", "name": "edit"},
                "subjects": [
                    {"kind": "ServiceAccount", "namespace": "default", "name": "sa-a"}
                ],
            },
        )
        event = normalize_audit(payload, "e21", "{}")
        assert event.audit_binding_subject == "ServiceAccount:default:sa-a"

    def test_binding_subject_combines_multiple_subjects_sorted(self, base_audit_event):
        payload = base_audit_event(
            verb="create",
            objectRef={"resource": "rolebindings", "namespace": "default", "name": "grant-multi"},
            responseStatus={"code": 201},
            requestObject={
                "roleRef": {"kind": "Role", "name": "edit"},
                "subjects": [
                    {"kind": "ServiceAccount", "namespace": "default", "name": "sa-b"},
                    {"kind": "ServiceAccount", "namespace": "default", "name": "sa-a"},
                ],
            },
        )
        event = normalize_audit(payload, "e22", "{}")
        assert event.audit_binding_subject == "ServiceAccount:default:sa-a,ServiceAccount:default:sa-b"

    def test_binding_subject_missing_returns_none(self, base_audit_event):
        payload = base_audit_event(
            verb="create",
            objectRef={"resource": "rolebindings", "namespace": "default", "name": "grant-none"},
            responseStatus={"code": 201},
            requestObject={"roleRef": {"kind": "Role", "name": "edit"}},
        )
        event = normalize_audit(payload, "e23", "{}")
        assert event.audit_binding_subject is None

    def test_binding_subject_only_computed_for_binding_resources(self, base_audit_event):
        # role_rule_flags 테스트와 대칭 - roles 리소스는 RBAC_BINDING_RESOURCES가
        # 아니라 _audit_binding_subject를 아예 호출하지 않는다.
        payload = base_audit_event(
            verb="create",
            objectRef={"resource": "roles", "namespace": "default", "name": "role-with-subjects-key"},
            responseStatus={"code": 201},
            requestObject={"subjects": [{"kind": "ServiceAccount", "namespace": "default", "name": "sa-a"}]},
        )
        event = normalize_audit(payload, "e24", "{}")
        assert event.audit_binding_subject is None
