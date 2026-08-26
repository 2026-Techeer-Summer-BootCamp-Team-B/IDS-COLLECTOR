"""normalize_cloud_audit() - GCP Cloud Audit Log(LogEntry) -> NormalizedEvent (P7-1).
severity.yaml의 실제 cloud_audit 규칙까지 그대로 태워서 검증한다(다른 소스 테스트와
동일한 방식 - test_normalize_waf.py 참고)."""
from datetime import datetime, timezone

from app.normalizer import normalize_cloud_audit


class TestNormalizeCloudAudit:
    def test_timestamp_read_from_payload(self, base_cloud_audit_log):
        event = normalize_cloud_audit(
            base_cloud_audit_log(timestamp="2026-07-15T10:00:00.000000Z"), "e0", "{}"
        )
        assert event.timestamp == datetime(2026, 7, 15, 10, 0, 0, tzinfo=timezone.utc)

    def test_event_action_is_method_name(self, base_cloud_audit_log):
        event = normalize_cloud_audit(
            base_cloud_audit_log(protoPayload={"methodName": "SetIamPolicy"}), "e1", "{}"
        )
        assert event.event_action == "SetIamPolicy"
        assert event.event_module == "cloud_audit"
        assert event.event_dataset == "cloud_audit.activity"

    def test_source_ip_and_user_name_from_proto_payload(self, base_cloud_audit_log):
        event = normalize_cloud_audit(
            base_cloud_audit_log(
                protoPayload={
                    "methodName": "SetIamPolicy",
                    "authenticationInfo": {"principalEmail": "attacker@example.com"},
                    "requestMetadata": {"callerIp": "203.0.113.10"},
                }
            ),
            "e2",
            "{}",
        )
        assert event.source_ip == "203.0.113.10"
        assert event.user_name == "attacker@example.com"

    def test_resource_name_uses_last_path_segment(self, base_cloud_audit_log):
        event = normalize_cloud_audit(
            base_cloud_audit_log(
                protoPayload={
                    "methodName": "v1.compute.firewalls.insert",
                    "resourceName": "projects/sentinel-ops-demo/global/firewalls/allow-all",
                }
            ),
            "e3",
            "{}",
        )
        assert event.orchestrator_resource_name == "allow-all"

    def test_cloud_service_name_and_project_id(self, base_cloud_audit_log):
        event = normalize_cloud_audit(
            base_cloud_audit_log(
                resource={"type": "gce_firewall_rule", "labels": {"project_id": "sentinel-ops-demo"}},
                protoPayload={"methodName": "v1.compute.firewalls.insert", "serviceName": "compute.googleapis.com"},
            ),
            "e4",
            "{}",
        )
        assert event.cloud_service_name == "compute.googleapis.com"
        assert event.cloud_project_id == "sentinel-ops-demo"

    def test_set_iam_policy_is_critical_severity(self, base_cloud_audit_log):
        event = normalize_cloud_audit(
            base_cloud_audit_log(protoPayload={"methodName": "SetIamPolicy"}), "e5", "{}"
        )
        assert event.event_severity == 4

    def test_unknown_method_falls_back_to_default_severity(self, base_cloud_audit_log):
        event = normalize_cloud_audit(
            base_cloud_audit_log(protoPayload={"methodName": "storage.objects.get"}), "e6", "{}"
        )
        assert event.event_severity == 2

    def test_status_code_present_means_failure(self, base_cloud_audit_log):
        event = normalize_cloud_audit(
            base_cloud_audit_log(
                protoPayload={"methodName": "SetIamPolicy", "status": {"code": 7, "message": "PERMISSION_DENIED"}}
            ),
            "e7",
            "{}",
        )
        assert event.event_outcome == "failure"

    def test_status_present_without_code_means_success(self, base_cloud_audit_log):
        event = normalize_cloud_audit(
            base_cloud_audit_log(protoPayload={"methodName": "SetIamPolicy", "status": {}}), "e8", "{}"
        )
        assert event.event_outcome == "success"

    def test_no_status_field_leaves_outcome_unset(self, base_cloud_audit_log):
        event = normalize_cloud_audit(
            base_cloud_audit_log(protoPayload={"methodName": "SetIamPolicy"}), "e9", "{}"
        )
        assert event.event_outcome is None
