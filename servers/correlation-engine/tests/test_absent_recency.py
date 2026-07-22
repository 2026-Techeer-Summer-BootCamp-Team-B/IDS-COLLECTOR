"""ScenarioEngine의 "동시 부재" 확인(absent_recent_module) - 이 패턴이 매칭되는
순간 지정된 모듈이 같은 join_key로 최근 발생한 적이 없어야 매칭으로 친다(rules.py의
_stamp_recency/_passes_absent_recent/_stage_matches). 카탈로그와 무관한 합성
시나리오로 엔진 메커니즘 자체만 검증한다(test_engine_sequence_multistage.py와 동일
방침)."""
from datetime import datetime, timedelta, timezone

from app.rules import ScenarioEngine

_SUPPLY_CHAIN_SCENARIO = {
    "id": "TEST-ABSENT-WAF",
    "db_id": "test-absent-waf-db-id",
    "name": "합성 부재 확인 테스트 시나리오",
    "type": "threshold",
    "join_on": "pod",
    "correlation_key_type": "orchestrator.resource.name",
    "required_modules": ["falco"],
    "window_seconds": 60,
    "threshold": 1,
    "cooldown_seconds": 600,
    "match": {
        "event_module": "falco",
        "event_action": "Known Cryptominer Process Executed",
        "absent_recent_module": "waf",
    },
    "severity": 4,
    "mitre_technique_id": "T1496",
}


async def _engine(redis_client, *scenarios) -> ScenarioEngine:
    return ScenarioEngine(list(scenarios), redis_client)


class TestAbsentRecentModule:
    async def test_fires_when_no_recent_waf_traffic(self, redis_client, make_event):
        engine = await _engine(redis_client, _SUPPLY_CHAIN_SCENARIO)
        event = make_event(
            event_module="falco",
            event_action="Known Cryptominer Process Executed",
            orchestrator_resource_name="pod-x",
        )
        fired = await engine.evaluate(event)
        assert len(fired) == 1
        assert fired[0]["scenario_name"] == "합성 부재 확인 테스트 시나리오"

    async def test_does_not_fire_when_recent_waf_traffic_exists(self, redis_client, make_event):
        engine = await _engine(redis_client, _SUPPLY_CHAIN_SCENARIO)
        pod = "pod-x"
        await engine.evaluate(make_event(event_module="waf", orchestrator_resource_name=pod))
        fired = await engine.evaluate(
            make_event(
                event_module="falco",
                event_action="Known Cryptominer Process Executed",
                orchestrator_resource_name=pod,
            )
        )
        assert fired == []

    async def test_waf_traffic_on_different_pod_does_not_suppress(self, redis_client, make_event):
        """부재 확인은 같은 join_key(pod) 기준이라, 다른 pod의 WAF 트래픽은 이
        pod의 부재 판정에 영향을 주면 안 된다."""
        engine = await _engine(redis_client, _SUPPLY_CHAIN_SCENARIO)
        await engine.evaluate(make_event(event_module="waf", orchestrator_resource_name="pod-other"))
        fired = await engine.evaluate(
            make_event(
                event_module="falco",
                event_action="Known Cryptominer Process Executed",
                orchestrator_resource_name="pod-x",
            )
        )
        assert len(fired) == 1

    async def test_fires_once_waf_traffic_ages_out_of_window(self, redis_client, make_event):
        """absent_recent_seconds를 override해서, 그 시간보다 더 전에 있었던 WAF
        이벤트는 더 이상 "최근"으로 안 쳐야 한다 - 이벤트의 timestamp를 직접
        제어해서 실제로 sleep하지 않고 결정적으로 검증한다(_passes_absent_recent가
        비교하는 now_ts는 wall-clock이 아니라 앵커 이벤트 자신의 timestamp)."""
        scenario = {
            **_SUPPLY_CHAIN_SCENARIO,
            "match": {**_SUPPLY_CHAIN_SCENARIO["match"], "absent_recent_seconds": 30},
        }
        engine = await _engine(redis_client, scenario)
        pod = "pod-x"
        base = datetime.now(timezone.utc)

        old_waf = make_event(event_module="waf", orchestrator_resource_name=pod, timestamp=base)
        await engine.evaluate(old_waf)

        later_falco = make_event(
            event_module="falco",
            event_action="Known Cryptominer Process Executed",
            orchestrator_resource_name=pod,
            timestamp=base + timedelta(seconds=31),
        )
        fired = await engine.evaluate(later_falco)
        assert len(fired) == 1

    async def test_absent_recent_module_accepts_list(self, redis_client, make_event):
        scenario = {
            **_SUPPLY_CHAIN_SCENARIO,
            "match": {**_SUPPLY_CHAIN_SCENARIO["match"], "absent_recent_module": ["waf", "was"]},
        }
        engine = await _engine(redis_client, scenario)
        pod = "pod-x"
        await engine.evaluate(make_event(event_module="was", orchestrator_resource_name=pod))
        fired = await engine.evaluate(
            make_event(
                event_module="falco",
                event_action="Known Cryptominer Process Executed",
                orchestrator_resource_name=pod,
            )
        )
        assert fired == []

    async def test_pattern_without_absent_recent_module_is_unaffected(self, redis_client, make_event):
        """absent_recent_module이 없는 일반 패턴은 recency 흔적과 무관하게 그대로
        동작해야 한다 - 기존 threshold/sequence 회귀 방지."""
        plain_scenario = {
            **_SUPPLY_CHAIN_SCENARIO,
            "id": "TEST-ABSENT-PLAIN",
            "match": {"event_module": "falco", "event_action": "Known Cryptominer Process Executed"},
        }
        engine = await _engine(redis_client, plain_scenario)
        pod = "pod-x"
        await engine.evaluate(make_event(event_module="waf", orchestrator_resource_name=pod))
        fired = await engine.evaluate(
            make_event(
                event_module="falco",
                event_action="Known Cryptominer Process Executed",
                orchestrator_resource_name=pod,
            )
        )
        assert len(fired) == 1
