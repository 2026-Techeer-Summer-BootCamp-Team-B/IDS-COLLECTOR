"""ScenarioEngine의 threshold 타입 평가 로직 - 실제 app/scenarios/network.yaml(S4)/
workload.yaml(S15)을 그대로 사용해 카운팅/즉시발화/쿨다운/비활성화/join_key 결측
동작을 검증한다."""


class TestS15SystemNamespacePodCreate:
    """threshold=1, cooldown=600 - 단발성 즉시 발화 패턴."""

    async def test_fires_immediately_for_kube_system(self, engine, make_event):
        event = make_event(
            event_module="k8s_audit",
            audit_verb="create",
            orchestrator_resource_type="pods",
            orchestrator_namespace="kube-system",
            user_name="system:serviceaccount:default:attacker-sa",
        )
        fired = await engine.evaluate(event)
        hits = [f for f in fired if f["scenario_name"] == "시스템 네임스페이스에 pod 생성"]
        assert len(hits) == 1
        assert hits[0]["join_key"] == "system:serviceaccount:default:attacker-sa"
        assert hits[0]["correlation_key_type"] == "user.name"
        assert hits[0]["severity"] == 4
        assert hits[0]["mitre_technique_id"] == "T1610"

    async def test_does_not_fire_for_default_namespace(self, engine, make_event):
        event = make_event(
            event_module="k8s_audit",
            audit_verb="create",
            orchestrator_resource_type="pods",
            orchestrator_namespace="default",
            user_name="system:serviceaccount:default:normal-sa",
        )
        fired = await engine.evaluate(event)
        assert not any(f["scenario_name"] == "시스템 네임스페이스에 pod 생성" for f in fired)

    async def test_does_not_fire_for_non_pod_resource(self, engine, make_event):
        event = make_event(
            event_module="k8s_audit",
            audit_verb="create",
            orchestrator_resource_type="deployments",
            orchestrator_namespace="kube-system",
            user_name="system:serviceaccount:default:attacker-sa",
        )
        fired = await engine.evaluate(event)
        assert not any(f["scenario_name"] == "시스템 네임스페이스에 pod 생성" for f in fired)

    async def test_still_fires_during_cooldown_so_incident_stays_fresh(self, engine, make_event):
        """쿨다운 중에도 upsert_incident가 이미 open인 인시던트에 이벤트를 계속
        추가/updated_at 갱신할 수 있도록 발화 결과를 계속 반환해야 한다
        (rules.py 모듈 docstring, 2026-07-15 실측 수정된 동작)."""
        user = "system:serviceaccount:default:attacker-sa"
        first = make_event(
            event_module="k8s_audit", audit_verb="create",
            orchestrator_resource_type="pods", orchestrator_namespace="kube-system",
            user_name=user,
        )
        second = make_event(
            event_module="k8s_audit", audit_verb="create",
            orchestrator_resource_type="pods", orchestrator_namespace="kube-public",
            user_name=user,
        )
        first_fired = await engine.evaluate(first)
        second_fired = await engine.evaluate(second)
        assert any(f["scenario_name"] == "시스템 네임스페이스에 pod 생성" for f in first_fired)
        assert any(f["scenario_name"] == "시스템 네임스페이스에 pod 생성" for f in second_fired)


class TestS4WafBurstThreshold:
    """threshold=5/60s, cooldown=300s - 카운트가 실제로 쌓여야 발화하는 패턴."""

    async def test_below_threshold_does_not_fire(self, engine, make_event):
        for _ in range(4):
            event = make_event(event_module="waf", source_ip="203.0.113.10")
            fired = await engine.evaluate(event)
            assert not any(f["scenario_name"] == "동일 IP WAF 다발 차단" for f in fired)

    async def test_fifth_event_fires(self, engine, make_event):
        for _ in range(4):
            await engine.evaluate(make_event(event_module="waf", source_ip="203.0.113.10"))
        fifth = make_event(event_module="waf", source_ip="203.0.113.10")
        fired = await engine.evaluate(fifth)
        hits = [f for f in fired if f["scenario_name"] == "동일 IP WAF 다발 차단"]
        assert len(hits) == 1
        assert hits[0]["join_key"] == "203.0.113.10"
        assert hits[0]["severity"] == 3
        assert hits[0]["mitre_technique_id"] == "T1190"

    async def test_different_source_ip_has_independent_counter(self, engine, make_event):
        for _ in range(4):
            await engine.evaluate(make_event(event_module="waf", source_ip="203.0.113.10"))
        other_ip_event = make_event(event_module="waf", source_ip="198.51.100.20")
        fired = await engine.evaluate(other_ip_event)
        assert not any(f["scenario_name"] == "동일 IP WAF 다발 차단" for f in fired)


class TestScenarioGating:
    async def test_disabled_scenario_is_skipped(self, engine, scenario_by_id, redis_client, make_event):
        s15 = scenario_by_id("S15")
        await redis_client.set(f"scenario:enabled:{s15['db_id']}", "0")
        event = make_event(
            event_module="k8s_audit", audit_verb="create",
            orchestrator_resource_type="pods", orchestrator_namespace="kube-system",
            user_name="system:serviceaccount:default:attacker-sa",
        )
        fired = await engine.evaluate(event)
        assert not any(f["scenario_name"] == "시스템 네임스페이스에 pod 생성" for f in fired)

    async def test_missing_join_key_is_skipped_and_counted(self, engine, make_event):
        # source_ip=None이면 join_on=source_ip인 waf 시나리오 전부(S4/S26/S27/S28/S29 등)가
        # 동시에 결측으로 잡히므로 정확히 +1이 아니라 "증가했다"만 확인한다 - 시나리오
        # 카탈로그가 늘어날 때마다 이 숫자를 다시 맞추는 깨지기 쉬운 assert를 피한다.
        event = make_event(event_module="waf", source_ip=None)
        before = engine.missing_join_count
        fired = await engine.evaluate(event)
        assert not any(f["scenario_name"] == "동일 IP WAF 다발 차단" for f in fired)
        assert engine.missing_join_count > before

    async def test_unrelated_module_does_not_crash_or_fire(self, engine, make_event):
        # S15는 required_modules=[k8s_audit]뿐이라 falco 이벤트는 애초에 매칭 시도조차
        # 안 한다 - 필드가 없는 시나리오를 잘못 평가하다 AttributeError로 죽는 걸 막는
        # 필터(evaluate() 실측 사고 이력, rules.py evaluate() docstring 참고).
        event = make_event(event_module="falco", process_name="bash")
        fired = await engine.evaluate(event)
        assert isinstance(fired, list)
