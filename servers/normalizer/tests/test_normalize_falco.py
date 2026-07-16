"""normalize_falco() - Falco json_output payload -> NormalizedEvent."""
from app.normalizer import normalize_falco


class TestNormalizeFalco:
    def test_priority_maps_to_severity(self, base_falco_event):
        emergency = normalize_falco(base_falco_event(priority="Emergency"), "e1", "{}")
        warning = normalize_falco(base_falco_event(priority="Warning"), "e2", "{}")
        debug = normalize_falco(base_falco_event(priority="Debug"), "e3", "{}")
        assert (emergency.event_severity, warning.event_severity, debug.event_severity) == (4, 2, 1)

    def test_unknown_priority_falls_back_to_medium_default(self, base_falco_event):
        # severity.yaml 주석: 모르는 priority를 low로 떨어뜨리면 이상 신호가 묻힐
        # 수 있어 medium(2)으로 둔다 - 누락이 아니라 명시적 설계.
        event = normalize_falco(base_falco_event(priority="SomeNewPriority"), "e4", "{}")
        assert event.event_severity == 2

    def test_source_ip_prefers_fd_rip_over_fd_sip(self, base_falco_event):
        event = normalize_falco(
            base_falco_event(output_fields={"fd.rip": "203.0.113.10", "fd.sip": "10.0.0.5"}),
            "e5",
            "{}",
        )
        assert event.source_ip == "203.0.113.10"

    def test_source_ip_falls_back_to_fd_sip(self, base_falco_event):
        event = normalize_falco(
            base_falco_event(output_fields={"fd.sip": "10.0.0.5"}), "e6", "{}"
        )
        assert event.source_ip == "10.0.0.5"

    def test_missing_output_fields_does_not_crash(self, base_falco_event):
        payload = base_falco_event(output_fields=None)
        event = normalize_falco(payload, "e7", "{}")
        assert event.source_ip is None
        assert event.orchestrator_resource_name is None

    def test_process_and_container_fields_mapped(self, base_falco_event):
        event = normalize_falco(
            base_falco_event(
                output_fields={
                    "k8s.ns.name": "default",
                    "k8s.pod.name": "victim-pod-abc123",
                    "user.name": "root",
                    "proc.name": "bash",
                    "proc.cmdline": "bash -c whoami",
                    "proc.pname": "sh",
                    "container.id": "abc123",
                    "container.image.repository": "bkimminich/juice-shop",
                }
            ),
            "e8",
            "{}",
        )
        assert event.orchestrator_namespace == "default"
        assert event.orchestrator_resource_name == "victim-pod-abc123"
        assert event.user_name == "root"
        assert event.process_name == "bash"
        assert event.process_command_line == "bash -c whoami"
        assert event.process_parent_name == "sh"
        assert event.container_id == "abc123"
        assert event.container_image_name == "bkimminich/juice-shop"

    def test_orchestrator_resource_type_is_always_pod(self, base_falco_event):
        # k8s.pod.name이 없어도 orchestrator.resource.type은 무조건 "pod" 하드코딩
        # - falco 룰 자체가 컨테이너/파드 컨텍스트를 전제하기 때문(구현 그대로 반영).
        event = normalize_falco(base_falco_event(output_fields={}), "e9", "{}")
        assert event.orchestrator_resource_type == "pod"
        assert event.orchestrator_resource_name is None

    def test_rule_and_action_both_come_from_rule_field(self, base_falco_event):
        event = normalize_falco(
            base_falco_event(rule="Terminal shell in container"), "e10", "{}"
        )
        assert event.event_action == "Terminal shell in container"
        assert event.rule_name == "Terminal shell in container"
        assert event.event_dataset == "falco.alert"
        assert event.event_outcome is None
