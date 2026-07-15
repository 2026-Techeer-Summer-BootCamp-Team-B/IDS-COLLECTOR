"""ScenarioEngine.set_allow_list()/_is_allow_listed() 검증 - 전역 vs target 스코프
항목, 그리고 falco/k8s_audit 이벤트(target_name이 항상 None)에 스코프 항목이
적용되지 않는 문서화된 예외까지."""


class TestIsAllowListed:
    def test_no_entries_never_suppresses(self, engine):
        assert engine._is_allow_listed("203.0.113.10", "juice-shop") is False

    def test_global_entry_suppresses_any_target(self, engine):
        engine.set_allow_list([{"ip_or_cidr": "203.0.113.0/24", "target_name": None}])
        assert engine._is_allow_listed("203.0.113.10", "juice-shop") is True
        assert engine._is_allow_listed("203.0.113.10", "juice-shop-2") is True
        assert engine._is_allow_listed("203.0.113.10", None) is True

    def test_scoped_entry_only_suppresses_matching_target(self, engine):
        engine.set_allow_list([{"ip_or_cidr": "203.0.113.0/24", "target_name": "juice-shop"}])
        assert engine._is_allow_listed("203.0.113.10", "juice-shop") is True
        assert engine._is_allow_listed("203.0.113.10", "juice-shop-2") is False
        assert engine._is_allow_listed("203.0.113.10", None) is False

    def test_ip_outside_network_is_never_suppressed(self, engine):
        engine.set_allow_list([{"ip_or_cidr": "203.0.113.0/24", "target_name": None}])
        assert engine._is_allow_listed("198.51.100.20", "juice-shop") is False

    def test_no_source_ip_is_never_suppressed(self, engine):
        engine.set_allow_list([{"ip_or_cidr": "203.0.113.0/24", "target_name": None}])
        assert engine._is_allow_listed(None, "juice-shop") is False

    def test_invalid_cidr_entries_are_skipped_silently(self, engine):
        # 입력 검증은 platform-api의 allow_list_api.py 책임 - 여기서는 파싱 실패를
        # 조용히 무시하고 다른 항목은 그대로 반영해야 한다.
        engine.set_allow_list([
            {"ip_or_cidr": "not-a-cidr", "target_name": None},
            {"ip_or_cidr": "203.0.113.0/24", "target_name": None},
        ])
        assert engine._is_allow_listed("203.0.113.10", None) is True


class TestAllowListShortCircuitsEvaluate:
    async def test_global_allow_listed_ip_suppresses_all_scenarios(self, engine, make_event):
        engine.set_allow_list([{"ip_or_cidr": "203.0.113.0/24", "target_name": None}])
        event = make_event(event_module="waf", source_ip="203.0.113.10", target_name="juice-shop")
        assert await engine.evaluate(event) == []

    async def test_scoped_allow_list_does_not_suppress_falco_event(self, engine, make_event):
        # falco/k8s_audit 이벤트는 target_name이 항상 None이라, target으로 스코프된
        # allow_list 항목(entry_target="juice-shop")과 일치하지 않아 억제되지 않는다
        # (rules.py ScenarioEngine.evaluate() docstring 참고).
        engine.set_allow_list([{"ip_or_cidr": "203.0.113.0/24", "target_name": "juice-shop"}])
        event = make_event(
            event_module="k8s_audit", audit_verb="create",
            orchestrator_resource_type="pods", orchestrator_namespace="kube-system",
            user_name="system:serviceaccount:default:attacker-sa",
            source_ip="203.0.113.10", target_name=None,
        )
        fired = await engine.evaluate(event)
        assert any(f["scenario_name"] == "시스템 네임스페이스에 pod 생성" for f in fired)
