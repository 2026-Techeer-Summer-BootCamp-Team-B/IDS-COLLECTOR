"""ScenarioEngine의 sequence 타입이 2단계를 넘어 임의 개수의 stageN을 지원하는지
검증한다(2026-07-19, rules.py의 _stage_patterns() 일반화). 실제 카탈로그(S1/S5)는
여전히 2단계뿐이라 test_engine_sequence.py가 그쪽을 담당하고, 여기서는 카탈로그와
무관한 합성(synthetic) 3/5단계 시나리오로 엔진 메커니즘 자체만 검증한다."""
from app.rules import ScenarioEngine

_THREE_STAGE_SCENARIO = {
    "id": "TEST-3STAGE",
    "db_id": "test-3stage-db-id",
    "name": "합성 3단계 테스트 시나리오",
    "type": "sequence",
    "join_on": "pod",
    "correlation_key_type": "orchestrator.resource.name",
    "required_modules": ["waf", "falco", "k8s_audit"],
    "window_seconds": 300,
    "stage1": {"event_module": "waf", "event_action": "sqli"},
    "stage2": {"event_module": "falco", "event_action": "Terminal shell in container"},
    "stage3": {"event_module": "k8s_audit", "event_action": "create serviceaccounts/token"},
    "severity": 4,
    "mitre_technique_id": "T1190",
}

# stage1/2/3/4/5까지 5단계 - "최대 4단계"라는 상한이 실제로 없다는 걸 증명하는 용도.
_FIVE_STAGE_SCENARIO = {
    **_THREE_STAGE_SCENARIO,
    "id": "TEST-5STAGE",
    "db_id": "test-5stage-db-id",
    "name": "합성 5단계 테스트 시나리오",
    "stage4": {"event_module": "waf", "event_action": "cors_abuse"},
    "stage5": {"event_module": "was", "http_response_status_code": 404},
    "required_modules": ["waf", "falco", "k8s_audit", "was"],
}


async def _engine(redis_client, *scenarios) -> ScenarioEngine:
    return ScenarioEngine(list(scenarios), redis_client)


class TestThreeStageSequence:
    async def test_stage1_alone_does_not_fire(self, redis_client, make_event):
        engine = await _engine(redis_client, _THREE_STAGE_SCENARIO)
        fired = await engine.evaluate(
            make_event(event_module="waf", event_action="sqli", orchestrator_resource_name="pod-x")
        )
        assert fired == []

    async def test_stage1_then_stage2_alone_does_not_fire(self, redis_client, make_event):
        """중간 단계(stage2)까지만 오면 아직 미완성 - 발화하면 안 된다."""
        engine = await _engine(redis_client, _THREE_STAGE_SCENARIO)
        pod = "pod-x"
        await engine.evaluate(make_event(event_module="waf", event_action="sqli", orchestrator_resource_name=pod))
        fired = await engine.evaluate(
            make_event(
                event_module="falco", event_action="Terminal shell in container",
                orchestrator_resource_name=pod,
            )
        )
        assert fired == []

    async def test_all_three_stages_in_order_fires_once(self, redis_client, make_event):
        engine = await _engine(redis_client, _THREE_STAGE_SCENARIO)
        pod = "pod-x"
        e1 = make_event(event_module="waf", event_action="sqli", orchestrator_resource_name=pod)
        e2 = make_event(
            event_module="falco", event_action="Terminal shell in container", orchestrator_resource_name=pod
        )
        e3 = make_event(
            event_module="k8s_audit", event_action="create serviceaccounts/token",
            orchestrator_resource_name=pod,
        )
        await engine.evaluate(e1)
        assert await engine.evaluate(e2) == []
        fired = await engine.evaluate(e3)
        assert len(fired) == 1
        assert fired[0]["scenario_name"] == "합성 3단계 테스트 시나리오"
        assert [e["event_id"] for e in fired[0]["events"]] == [e1.event_id, e2.event_id, e3.event_id]

    async def test_skipping_stage2_does_not_advance(self, redis_client, make_event):
        """stage1만 매칭된 상태에서 stage3 패턴이 바로 오면(stage2를 건너뜀) 전진하면
        안 된다 - "바로 다음 단계"만 진행을 인정한다."""
        engine = await _engine(redis_client, _THREE_STAGE_SCENARIO)
        pod = "pod-x"
        await engine.evaluate(make_event(event_module="waf", event_action="sqli", orchestrator_resource_name=pod))
        skip_to_stage3 = make_event(
            event_module="k8s_audit", event_action="create serviceaccounts/token",
            orchestrator_resource_name=pod,
        )
        assert await engine.evaluate(skip_to_stage3) == []

        # 아직 stage2를 기다리는 상태 그대로여야 하므로, 이제 진짜 stage2가 오면
        # 정상적으로 전진해서 stage3까지 도달했을 때 발화해야 한다.
        await engine.evaluate(
            make_event(
                event_module="falco", event_action="Terminal shell in container",
                orchestrator_resource_name=pod,
            )
        )
        fired = await engine.evaluate(
            make_event(
                event_module="k8s_audit", event_action="create serviceaccounts/token",
                orchestrator_resource_name=pod,
            )
        )
        assert len(fired) == 1

    async def test_stage1_rematch_resets_progress_mid_chain(self, redis_client, make_event):
        """stage2까지 진행된 상태에서 stage1이 다시 매칭되면 진행 상황을 버리고
        처음부터 다시 시작한다(기존 2단계 "stage1 최신 덮어쓰기"의 일반화)."""
        engine = await _engine(redis_client, _THREE_STAGE_SCENARIO)
        pod = "pod-x"
        old_stage1 = make_event(event_module="waf", event_action="sqli", orchestrator_resource_name=pod)
        await engine.evaluate(old_stage1)
        await engine.evaluate(
            make_event(
                event_module="falco", event_action="Terminal shell in container",
                orchestrator_resource_name=pod,
            )
        )
        new_stage1 = make_event(event_module="waf", event_action="sqli", orchestrator_resource_name=pod)
        await engine.evaluate(new_stage1)

        # stage2를 다시 거치지 않고 stage3만 오면(리셋됐으니) 여전히 미완성이어야 한다.
        fired = await engine.evaluate(
            make_event(
                event_module="k8s_audit", event_action="create serviceaccounts/token",
                orchestrator_resource_name=pod,
            )
        )
        assert fired == []

        # stage2 -> stage3까지 다시 밟으면 발화하고, 그때 stage1 이벤트는 새 것이어야 한다.
        await engine.evaluate(
            make_event(
                event_module="falco", event_action="Terminal shell in container",
                orchestrator_resource_name=pod,
            )
        )
        e3 = make_event(
            event_module="k8s_audit", event_action="create serviceaccounts/token",
            orchestrator_resource_name=pod,
        )
        fired = await engine.evaluate(e3)
        assert len(fired) == 1
        assert fired[0]["events"][0]["event_id"] == new_stage1.event_id

    async def test_different_join_key_does_not_cross(self, redis_client, make_event):
        engine = await _engine(redis_client, _THREE_STAGE_SCENARIO)
        await engine.evaluate(make_event(event_module="waf", event_action="sqli", orchestrator_resource_name="pod-a"))
        await engine.evaluate(
            make_event(
                event_module="falco", event_action="Terminal shell in container",
                orchestrator_resource_name="pod-b",
            )
        )
        fired = await engine.evaluate(
            make_event(
                event_module="k8s_audit", event_action="create serviceaccounts/token",
                orchestrator_resource_name="pod-b",
            )
        )
        assert fired == []


class TestFiveStageSequence:
    """단계 수에 하드코딩된 상한이 없다는 걸 증명 - stage5까지 전부 순서대로 와야
    발화한다."""

    async def test_all_five_stages_required(self, redis_client, make_event):
        engine = await _engine(redis_client, _FIVE_STAGE_SCENARIO)
        pod = "pod-x"
        events = [
            make_event(event_module="waf", event_action="sqli", orchestrator_resource_name=pod),
            make_event(
                event_module="falco", event_action="Terminal shell in container",
                orchestrator_resource_name=pod,
            ),
            make_event(
                event_module="k8s_audit", event_action="create serviceaccounts/token",
                orchestrator_resource_name=pod,
            ),
            make_event(event_module="waf", event_action="cors_abuse", orchestrator_resource_name=pod),
            make_event(event_module="was", http_response_status_code=404, orchestrator_resource_name=pod),
        ]
        for e in events[:-1]:
            assert await engine.evaluate(e) == []
        fired = await engine.evaluate(events[-1])
        assert len(fired) == 1
        assert [e["event_id"] for e in fired[0]["events"]] == [e.event_id for e in events]

    async def test_four_of_five_stages_does_not_fire(self, redis_client, make_event):
        engine = await _engine(redis_client, _FIVE_STAGE_SCENARIO)
        pod = "pod-x"
        events = [
            make_event(event_module="waf", event_action="sqli", orchestrator_resource_name=pod),
            make_event(
                event_module="falco", event_action="Terminal shell in container",
                orchestrator_resource_name=pod,
            ),
            make_event(
                event_module="k8s_audit", event_action="create serviceaccounts/token",
                orchestrator_resource_name=pod,
            ),
            make_event(event_module="waf", event_action="cors_abuse", orchestrator_resource_name=pod),
        ]
        fired = []
        for e in events:
            fired = await engine.evaluate(e)
        assert fired == []
