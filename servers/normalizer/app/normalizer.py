"""
Kafka에서 꺼낸 로그 payload(dict)를 공통 스키마(NormalizedEvent)로 변환하는 모듈.

source는 P2-1 토픽 분리 이후로는 Kafka 토픽 자체가 알려준다 (events.was/waf/falco/audit
-> was/waf/falco/audit - 이 내부 dispatch 값은 event.module 저장값과 다르다: audit
토픽/파서 dispatch는 "audit"를 그대로 쓰지만 저장되는 event.module 값은 "k8s_audit"다).
dedupe 키(event_id)와 원본 문자열(event_original)은 dedupe가 이미 계산해둔 뒤라
main.py에서 그대로 넘겨받는다 - 여기서 다시 계산하지 않는다.

심각도(event.severity)는 app/severity.py(severity.yaml) 참고 - 이 모듈은 값을
하드코딩하지 않고 소스별 판단에 필요한 원본 필드만 넘긴다.

orchestrator.namespace/resource.type/resource.name의 was/waf 쪽 정적 매핑(단일 타깃
전제)은 여기서 채우지 않는다 - app/enrichment.py가 담당 (falco/audit는 자기 payload로
동적으로 나오므로 여기서 채운다).
"""
from datetime import datetime, timezone
from typing import Any, Dict, List

from app.severity import get_severity
from ids_shared.k8s_constants import RBAC_BINDING_RESOURCES, RBAC_ROLE_RESOURCES
from ids_shared.schemas import NormalizedEvent


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _parse_timestamp(value: Any) -> datetime:
    if not value:
        return _now_utc()
    try:
        ts = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    except ValueError:
        return _now_utc()


# ---------------------------------------------------------------------------
# WAS (nginx raw access log)
# ---------------------------------------------------------------------------


def _was_source_ip(payload: Dict[str, Any]) -> Any:
    """XFF 첫 홉 우선, 없으면 remote_addr.

    [Target 액션 완료, 2026-07-12] nginx log format(juice-shop-nginx-configmap.yaml)에
    $http_x_forwarded_for 추가됨 - 단 tests/dummy_generator.py가 아직 이 헤더를 안 보내서
    지금도 대부분 remote_addr로 폴백 중(S4 join_on=source_ip 정확도에 영향). 여러 공격자
    IP를 재현하려면 생성기가 요청마다 랜덤 X-Forwarded-For를 보내도록 수정 필요 - 정규화
    문서(Notion "정규화" §4-1/§6) 참고.
    """
    xff = payload.get("http_x_forwarded_for") or payload.get("x_forwarded_for")
    if xff:
        return xff.split(",")[0].strip()
    return payload.get("remote_addr")


def _was_duration_ns(payload: Dict[str, Any]) -> Any:
    request_time = payload.get("request_time")
    if request_time is None:
        return None
    try:
        return int(float(request_time) * 1_000_000_000)
    except (TypeError, ValueError):
        return None


def normalize_was(payload: Dict[str, Any], event_id: str, original: str) -> NormalizedEvent:
    """Nginx access log(JSON) 한 줄을 NormalizedEvent로 변환."""
    status = payload.get("status")

    return NormalizedEvent(
        **{
            "@timestamp": _parse_timestamp(payload.get("time")),
            "event.ingested": _now_utc(),
            "event.id": event_id,
            "event.module": "was",
            "event.dataset": "was.access",
            "event.kind": "event",
            "event.action": payload.get("method"),
            "event.outcome": "success" if (status and status < 400) else "failure",
            "event.severity": get_severity("was", payload),
            "event.duration": _was_duration_ns(payload),
            "event.original": original,
            "source.ip": _was_source_ip(payload),
            "container.name": "nginx-was-logger",
            "http.request.method": payload.get("method"),
            "url.path": payload.get("path"),
            "url.query": payload.get("query"),
            "http.request.referrer": payload.get("referrer"),
            "http.response.status_code": status,
            "http.response.body.bytes": payload.get("body_bytes_sent"),
            "user_agent.original": payload.get("user_agent"),
            # nginx-was-logger가 Downward API(POD_NAME/POD_NAMESPACE)로 자기 자신의
            # 실제 pod를 log_format에 실어 보낸 값(juice-shop-nginx-configmap.yaml
            # 참고) - 정적 하드코딩이 아니라 이 로그를 실제로 남긴 pod를 항상 정확히
            # 가리킨다. enrichment.py는 이 값이 비어 있을 때만 폴백으로 채운다.
            "orchestrator.namespace": payload.get("orchestrator_namespace") or None,
            "orchestrator.resource.type": "pod" if payload.get("orchestrator_pod") else None,
            "orchestrator.resource.name": payload.get("orchestrator_pod") or None,
            # nginx-was-logger의 TARGET_NAME(배포 시점 고정값, juice-shop-nginx-
            # configmap.yaml/juice-shop-with-nginx-sidecar.yaml 참고) - 여러 타깃을
            # 보호하게 되면 타깃마다 이 값이 다르게 설정된다.
            "target.name": payload.get("target_name") or None,
        }
    )


# ---------------------------------------------------------------------------
# WAF (WafAlert 센서 스펙)
# ---------------------------------------------------------------------------


def normalize_waf(payload: Dict[str, Any], event_id: str, original: str) -> NormalizedEvent:
    """WafAlert 한 건을 NormalizedEvent로 변환.

    wire 필드: attack_type / risk_level / matched_rule_id / matched_rule_name /
    payload_snippet / target_endpoint / http_method / user_agent / blocked / mode /
    source_ip / target_name (+ target_pod_name / target_namespace).
    센서 개편으로 필드명이 바뀌면 이 파서와 본 계약 문서를 같이 갱신할 것.
    """
    return NormalizedEvent(
        **{
            "@timestamp": _parse_timestamp(payload.get("time")),
            "event.ingested": _now_utc(),
            "event.id": event_id,
            "event.module": "waf",
            "event.dataset": "waf.alert",
            "event.kind": "alert",
            "event.action": payload.get("attack_type"),
            # WAF도 falco와 마찬가지로 "탐지/차단" alert라 outcome 개념을 억지로
            # 붙이지 않는다 (해당 없는 필드는 생략).
            "event.severity": get_severity("waf", payload),
            "event.original": original,
            "rule.id": payload.get("matched_rule_id"),
            "rule.name": payload.get("matched_rule_name"),
            "source.ip": payload.get("source_ip"),
            "http.request.method": payload.get("http_method"),
            "url.path": payload.get("target_endpoint"),
            "user_agent.original": payload.get("user_agent"),
            "waf.risk_level": payload.get("risk_level"),
            "waf.payload_snippet": payload.get("payload_snippet"),
            "waf.blocked": payload.get("blocked"),
            "waf.mode": payload.get("mode"),
            # WAF backend가 Juice Shop의 응답 헤더(X-Served-By-Pod/Namespace)를 그대로
            # 옮겨 담은 값(app/proxy/proxy.py 참고) - prevention 모드로 차단된 요청은
            # Juice Shop까지 안 가서 둘 다 None. enrichment.py는 이 값이 비어 있을
            # 때만(예: 차단된 요청) 폴백으로 채운다.
            "orchestrator.namespace": payload.get("target_namespace") or None,
            "orchestrator.resource.type": "pod" if payload.get("target_pod_name") else None,
            "orchestrator.resource.name": payload.get("target_pod_name") or None,
            # WAF backend의 TARGET_NAME(배포 시점 고정값, config.py 참고) - WafAlert에
            # 이미 있던(그동안 아무도 안 채우던) target_name 필드를 이제 실제로 쓴다.
            "target.name": payload.get("target_name") or None,
        }
    )


# ---------------------------------------------------------------------------
# Falco
# ---------------------------------------------------------------------------


def normalize_falco(payload: Dict[str, Any], event_id: str, original: str) -> NormalizedEvent:
    """Falco json_output 한 줄을 NormalizedEvent로 변환.

    output_fields는 Falco 룰의 output_fields 설정에 따라 키가 달라질 수 있어서,
    자주 쓰이는 키들(k8s.ns.name/k8s.pod.name/user.name/fd.*ip/proc.*/container.*)
    위주로만 우선 매핑.
    """
    output_fields = payload.get("output_fields") or {}

    return NormalizedEvent(
        **{
            "@timestamp": _parse_timestamp(payload.get("time")),
            "event.ingested": _now_utc(),
            "event.id": event_id,
            "event.module": "falco",
            "event.dataset": "falco.alert",
            "event.kind": "alert",
            "event.action": payload.get("rule"),
            # Falco의 event.outcome은 "-"(해당 없음) -> 생략.
            "event.severity": get_severity("falco", payload),
            "event.original": original,
            "rule.name": payload.get("rule"),
            # 네트워크 룰일 때만 채워짐 (fd.rip/fd.sip 없으면 None -> 생략).
            "source.ip": output_fields.get("fd.rip") or output_fields.get("fd.sip"),
            "user.name": output_fields.get("user.name"),
            "orchestrator.namespace": output_fields.get("k8s.ns.name"),
            "orchestrator.resource.type": "pod",
            "orchestrator.resource.name": output_fields.get("k8s.pod.name"),
            "process.name": output_fields.get("proc.name"),
            "process.command_line": output_fields.get("proc.cmdline"),
            "process.parent.name": output_fields.get("proc.pname"),
            "container.id": output_fields.get("container.id"),
            "container.image.name": output_fields.get("container.image.repository"),
            "falco.priority": payload.get("priority"),
            "falco.tags": payload.get("tags"),
        }
    )


# ---------------------------------------------------------------------------
# K8s Audit
# ---------------------------------------------------------------------------

_RBAC_WRITE_VERBS = {"create", "update", "patch", "delete", "deletecollection"}


def _audit_request_objects(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    """requestObject는 보통 단일 dict지만, kubectl patch --type=json으로 온 요청은
    body 자체가 JSON Patch 연산 배열이라 dict가 아니다 - 예전엔 이 경우
    request_object.get(...)이 AttributeError를 던져서 main.py가 이벤트 전체를
    DLQ로 흘려보내고 원본 RBAC 변경이 통째로 유실됐다. 배열이면 안의 dict 원소를
    각각 하나의 감사 대상으로 보고 아래 _audit_* 함수들이 전부 순회하며 결과를
    합치게 한다 - dict가 아닌 원소(문자열 등)만 조용히 걸러낸다."""
    request_object = payload.get("requestObject")
    if isinstance(request_object, dict):
        return [request_object]
    if isinstance(request_object, list):
        return [item for item in request_object if isinstance(item, dict)]
    return []


def _audit_role_rule_flags(payload: Dict[str, Any]) -> Any:
    """role/clusterrole의 request body(rules)를 훑어서 위험한 권한 부여를 태깅.

    k3d-audit-policy.yaml이 roles/clusterroles의 create/update/patch/delete만
    RequestResponse 레벨로 남겨서 requestObject가 실제로 들어온다 - pods 등
    나머지 리소스는 Metadata 레벨이라 requestObject 자체가 없어서 이 함수를
    아예 안 부른다(호출부의 resource 분기 참고). requestObject가 JSON Patch
    배열인 경우 배열 안의 모든 dict 원소에서 나온 플래그를 합집합으로 반환한다.
    """
    flags = set()
    for request_object in _audit_request_objects(payload):
        rules = request_object.get("rules") or []
        for rule in rules:
            resources = rule.get("resources") or []
            verbs = rule.get("verbs") or []
            if "*" in resources:
                flags.add("wildcard_resource")
            if "*" in verbs:
                flags.add("wildcard_verb")
            if _RBAC_WRITE_VERBS.intersection(verbs):
                flags.add("write_verb")
            if "pods/exec" in resources:
                flags.add("pods_exec")

    return sorted(flags) if flags else None


def _audit_binding_role_name(payload: Dict[str, Any]) -> Any:
    """rolebinding/clusterrolebinding의 request body에서 roleRef.name을 뽑는다
    (예: "cluster-admin"에 바인딩했는지 판단하는 재료). requestObject가 JSON
    Patch 배열이면 배열 안의 모든 dict 원소에서 나온 이름을 리스트로 합쳐서
    반환한다(스키마도 Optional[List[str]] - correlation-engine은 _match_any_flag로
    매칭한다)."""
    names = set()
    for request_object in _audit_request_objects(payload):
        name = (request_object.get("roleRef") or {}).get("name")
        if name:
            names.add(name)

    return sorted(names) if names else None


def _audit_pod_security_flags(payload: Dict[str, Any]) -> Any:
    """새로 생성되는 pod의 request body(spec)를 훑어서 컨테이너 이스케이프
    벡터를 태깅한다 (privileged/hostNetwork/hostPID/hostIPC/hostPath 마운트).

    k3d-audit-policy.yaml이 pods의 create만 Request 레벨로 남겨서 requestObject가
    들어온다(2026-07-12) - update/patch 등 다른 verb는 여전히 Metadata라 이 함수를
    호출부에서 verb=="create"일 때만 부른다. 전부 생성 이후 바뀔 수 없는 불변
    필드라 create 시점 한 번만 보면 충분하다. requestObject가 JSON Patch 배열인
    경우 배열 안의 모든 dict 원소에서 나온 플래그를 합집합으로 반환한다.
    """
    flags = set()
    for request_object in _audit_request_objects(payload):
        spec = request_object.get("spec") or {}

        if spec.get("hostNetwork"):
            flags.add("host_network")
        if spec.get("hostPID"):
            flags.add("host_pid")
        if spec.get("hostIPC"):
            flags.add("host_ipc")

        containers = (spec.get("containers") or []) + (spec.get("initContainers") or [])
        for container in containers:
            security_context = container.get("securityContext") or {}
            if security_context.get("privileged"):
                flags.add("privileged")

        for volume in spec.get("volumes") or []:
            if "hostPath" in volume:
                flags.add("host_path_volume")

    return sorted(flags) if flags else None


def _audit_service_type(payload: Dict[str, Any]) -> Any:
    """service의 request body에서 spec.type을 뽑는다 (NodePort면 클러스터 밖으로
    새로 노출되는 경로가 생겼다는 뜻). pod의 hostNetwork류와 달리 spec.type은
    생성 후에도 patch/update로 바뀔 수 있어서 호출부는 create뿐 아니라 update/patch
    verb에서도 이 함수를 부른다. requestObject가 JSON Patch 배열이면 배열 안의 모든
    dict 원소에서 나온 타입을 리스트로 합쳐서 반환한다(스키마도 Optional[List[str]] -
    correlation-engine은 _match_any_flag로 매칭한다)."""
    types_ = set()
    for request_object in _audit_request_objects(payload):
        service_type = (request_object.get("spec") or {}).get("type")
        if service_type:
            types_.add(service_type)

    return sorted(types_) if types_ else None


# falcosecurity/plugins의 contains_private_credentials 매크로 그대로 - configmap
# 객체 전체(문자열화 기준)에 이 문자열 중 하나라도 있으면 자격증명으로 간주.
# 대소문자 구분 없음 처리는 원본 매크로에 없으므로 그대로 대소문자 구분 유지.
_CREDENTIAL_MARKERS = (
    "aws_access_key_id",
    "aws-access-key-id",
    "aws_s3_access_key_id",
    "aws-s3-access-key-id",
    "password",
    "passphrase",
)


def _audit_configmap_has_credentials(payload: Dict[str, Any]) -> Any:
    """configmap의 request body(data/binaryData)에 평문 자격증명으로 보이는
    문자열이 있는지 검사한다. Secret과 달리 ConfigMap은 암호화/난독화 없이
    저장되므로 이런 실수가 실제 자격증명 노출로 이어진다. requestObject가
    JSON Patch 배열이면 배열 안의 dict 원소 중 하나라도 자격증명으로 보이면
    True를 반환한다.

    각 조각을 공백으로 구분해서 합친다 - 예전엔 그룹끼리(키 전체/값 전체) 구분자
    없이 이어붙여서 마지막 키와 첫 값이 붙어버렸다(예: 키 "...pass" + 값
    "word..." -> "...password..." 오탐). binaryData는 키만 보고 값(base64 인코딩된
    바이트)은 아예 안 봤는데, data와 동일하게 값도 haystack에 포함시킨다."""
    for request_object in _audit_request_objects(payload):
        data = request_object.get("data") or {}
        binary_data = request_object.get("binaryData") or {}

        haystack = " ".join(
            str(item)
            for item in (
                list(data.keys())
                + list(data.values())
                + list(binary_data.keys())
                + list(binary_data.values())
            )
        )

        if haystack and any(marker in haystack for marker in _CREDENTIAL_MARKERS):
            return True

    return None


def _audit_ingress_has_tls(payload: Dict[str, Any]) -> Any:
    """ingress의 request body(spec)에 tls 키가 있는지 검사한다(값이 빈 배열이어도
    "존재"로 친다 - falcosecurity/plugins의 ingress_tls 매크로
    `jevt.value[/requestObject/spec/tls] exists`와 동일 판정). requestObject
    자체가 없으면(예: 감사정책이 안 맞아 body가 안 온 경우) 판정 불가라 None을
    반환 - False(명시적으로 tls 없음)와 구분해서 오탐을 막는다. requestObject가
    JSON Patch 배열이면 배열 안 dict 원소 중 하나라도 tls 키가 있으면 True를
    반환한다(다른 _audit_* 함수들과 같은 패턴)."""
    request_objects = _audit_request_objects(payload)
    if not request_objects:
        return None

    return any("tls" in (request_object.get("spec") or {}) for request_object in request_objects)


def normalize_audit(payload: Dict[str, Any], event_id: str, original: str) -> NormalizedEvent:
    """kube-apiserver audit 로그(audit.k8s.io/v1 Event JSON) 한 줄을 NormalizedEvent로 변환.

    호출하는 쪽(main.py)에서 stage != "ResponseComplete"인 레코드는 이 함수까지
    오지 않고 이미 걸러진다 (RequestReceived 등 중간 스테이지 드롭)."""
    user = payload.get("user") or {}
    object_ref = payload.get("objectRef") or {}
    response_status = payload.get("responseStatus") or {}
    source_ips = payload.get("sourceIPs") or []
    status_code = response_status.get("code")

    verb = payload.get("verb", "") or ""
    resource = object_ref.get("resource", "") or ""
    subresource = object_ref.get("subresource", "") or ""

    # event.action에는 subresource까지 붙여서 "create pods/exec"처럼 남긴다.
    resource_full = f"{resource}/{subresource}" if subresource else resource

    role_rule_flags = _audit_role_rule_flags(payload) if resource in RBAC_ROLE_RESOURCES else None
    binding_role_name = _audit_binding_role_name(payload) if resource in RBAC_BINDING_RESOURCES else None
    pod_security_flags = _audit_pod_security_flags(payload) if (resource == "pods" and verb == "create") else None

    # event.action에 위험 플래그를 붙여서 "create pods"(severity=2, 일반 생성)와
    # "create pods [host_path_volume]"(severity=4, S16 재료)를 화면에서 바로 구분할 수
    # 있게 한다(2026-07-18) - 이전엔 둘 다 event.action이 "create pods"로 동일해서
    # kubernetes.audit.pod.security_flags 필드를 따로 펼쳐보지 않는 한 왜 같은
    # 액션인데 severity가 다른지 알 수 없었다. correlation-engine의 어떤 시나리오도
    # subresource 없는 순수 "create pods" 문자열을 event_action으로 정확히 매치하지
    # 않는다(S16은 orchestrator_resource_type/pod_security_flags_any 같은 별도
    # 필드로 매치) - event.action에 접미사를 붙여도 상관분석 매칭에 영향 없음.
    action_flag_suffix = f" [{', '.join(pod_security_flags)}]" if pod_security_flags else ""
    service_type = (
        _audit_service_type(payload)
        if (resource == "services" and verb in ("create", "update", "patch"))
        else None
    )
    configmap_has_credentials = (
        _audit_configmap_has_credentials(payload)
        if (resource == "configmaps" and verb in ("create", "update", "patch"))
        else None
    )
    ingress_has_tls = (
        _audit_ingress_has_tls(payload) if (resource == "ingresses" and verb == "create") else None
    )

    return NormalizedEvent(
        **{
            "@timestamp": _parse_timestamp(
                payload.get("stageTimestamp") or payload.get("requestReceivedTimestamp")
            ),
            "event.ingested": _now_utc(),
            "event.id": event_id,
            "event.module": "k8s_audit",
            "event.dataset": "k8s_audit.audit",
            "event.kind": "event",
            "event.action": f"{verb} {resource_full}{action_flag_suffix}".strip(),
            "event.outcome": "success" if (status_code and status_code < 400) else "failure",
            "event.severity": get_severity(
                "audit",
                payload,
                audit_flags={
                    "pod_security_flags": pod_security_flags,
                    "service_type": service_type,
                    "configmap_has_credentials": configmap_has_credentials,
                    "ingress_has_tls": ingress_has_tls,
                },
            ),
            "event.original": original,
            "source.ip": source_ips[0] if source_ips else None,
            "user.name": user.get("username"),
            "orchestrator.namespace": object_ref.get("namespace"),
            "orchestrator.resource.type": resource or None,
            "orchestrator.resource.name": object_ref.get("name"),
            "kubernetes.audit.stage": payload.get("stage"),
            "kubernetes.audit.verb": verb or None,
            "kubernetes.audit.user.groups": user.get("groups"),
            "kubernetes.audit.role.rule_flags": role_rule_flags,
            "kubernetes.audit.binding.role_name": binding_role_name,
            "kubernetes.audit.pod.security_flags": pod_security_flags,
            "kubernetes.audit.service.type": service_type,
            "kubernetes.audit.configmap.has_credentials": configmap_has_credentials,
            "kubernetes.audit.ingress.has_tls": ingress_has_tls,
            "http.response.status_code": status_code,
        }
    )


_PARSERS = {
    "was": normalize_was,
    "waf": normalize_waf,
    "falco": normalize_falco,
    "audit": normalize_audit,
}


def normalize(source: str, payload: Dict[str, Any], event_id: str, original: str) -> NormalizedEvent:
    """source(Kafka 토픽에서 파생된 값)에 따라 알맞은 정규화 함수로 라우팅.

    알 수 없는 source면 ValueError를 던진다 - main.py가 이걸 parse 실패로 보고
    DLQ로 보낸다 (P3-7). 정규화 자체가 실패한 케이스(필드 누락 등)도 이 경로로 흡수된다.
    """
    parser = _PARSERS.get(source)
    if parser is None:
        raise ValueError(f"알 수 없는 소스: {source}")
    return parser(payload, event_id, original)
