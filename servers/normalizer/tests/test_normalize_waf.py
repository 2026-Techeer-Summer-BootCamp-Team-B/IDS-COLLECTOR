"""normalize_waf() - WafAlert 센서 payload -> NormalizedEvent."""
from datetime import datetime, timezone

from app.normalizer import normalize_waf


class TestNormalizeWaf:
    def test_timestamp_read_from_payload_not_ingestion_time(self, base_waf_alert):
        """WafAlert의 wire 필드명은 "timestamp"다(WAS의 "time"과 다름) - 예전엔
        normalize_waf가 "time"을 읽어서 항상 못 찾고 정규화 처리 시각(now)으로
        폴백했다(2026-07-21 실측 확인). 탐지된 실제 시각이 그대로 반영돼야 한다."""
        event = normalize_waf(base_waf_alert(timestamp="2026-07-15T10:00:00Z"), "e0", "{}")
        assert event.timestamp == datetime(2026, 7, 15, 10, 0, 0, tzinfo=timezone.utc)

    def test_risk_level_maps_to_severity(self, base_waf_alert):
        low = normalize_waf(base_waf_alert(risk_level="LOW"), "e1", "{}")
        medium = normalize_waf(base_waf_alert(risk_level="MEDIUM"), "e2", "{}")
        critical = normalize_waf(base_waf_alert(risk_level="CRITICAL"), "e3", "{}")
        assert (low.event_severity, medium.event_severity, critical.event_severity) == (2, 3, 4)

    def test_unknown_risk_level_falls_back_to_default(self, base_waf_alert):
        event = normalize_waf(base_waf_alert(risk_level="UNKNOWN"), "e4", "{}")
        assert event.event_severity == 2

    def test_rule_id_and_name_separately_mapped(self, base_waf_alert):
        event = normalize_waf(
            base_waf_alert(
                matched_rule_id="sqli_union_select",
                matched_rule_name="SQL Injection: UNION SELECT",
            ),
            "e5",
            "{}",
        )
        assert event.rule_id == "sqli_union_select"
        assert event.rule_name == "SQL Injection: UNION SELECT"

    def test_event_action_is_attack_type(self, base_waf_alert):
        event = normalize_waf(base_waf_alert(attack_type="brute_force"), "e6", "{}")
        assert event.event_action == "brute_force"
        assert event.event_dataset == "waf.alert"
        assert event.event_kind == "alert"

    def test_orchestrator_fields_from_target_pod(self, base_waf_alert):
        event = normalize_waf(
            base_waf_alert(
                target_namespace="default",
                target_pod_name="juice-shop-xyz",
                target_name="juice-shop",
            ),
            "e7",
            "{}",
        )
        assert event.orchestrator_namespace == "default"
        assert event.orchestrator_resource_type == "pod"
        assert event.orchestrator_resource_name == "juice-shop-xyz"
        assert event.target_name == "juice-shop"

    def test_orchestrator_fields_absent_on_prevention_block(self, base_waf_alert):
        # prevention 모드로 차단되면 Juice Shop까지 안 가서 X-Served-By-* 헤더가
        # 없다 - target_pod_name/target_namespace가 비어 있는 게 정상 케이스이고
        # enrichment.py의 정적 폴백은 이 함수가 아니라 그쪽 책임이다.
        event = normalize_waf(base_waf_alert(mode="prevention", blocked=True), "e8", "{}")
        assert event.orchestrator_namespace is None
        assert event.orchestrator_resource_type is None
        assert event.orchestrator_resource_name is None

    def test_no_event_outcome_field(self, base_waf_alert):
        # WAF는 outcome 개념이 없어 생략(None) - falco와 동일 취급.
        event = normalize_waf(base_waf_alert(), "e9", "{}")
        assert event.event_outcome is None
