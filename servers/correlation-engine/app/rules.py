"""시나리오 룰 실행기 (P4-1, P4-3). sequence/threshold 2타입.

sequence: stage1 패턴이 매칭되면 join_key별로 "stage1 대기중" 상태(이벤트 id+모듈)를
          Redis에 TTL=window_seconds로 기록한다. 그 안에 stage2 패턴이 매칭되면 발화.
          stage1이 대기 중에 또 매칭되면 최신 것으로 덮어쓴다 (stage1 최신 덮어쓰기).

threshold: join_key별 매칭 카운터를 Redis에 TTL=window_seconds로 유지한다. count가
           threshold 이상이면 발화 -> 카운터 리셋 + 쿨다운 키를 세팅해서 쿨다운
           기간 동안 재발화를 막는다.

join_key가 없는 이벤트(join_on 필드가 비어있는 경우)는 상관에서 제외하고 결측
카운터만 올린다 (파이프라인 헬스 뷰 P7-3에서 노출).

evaluate()가 반환하는 "발화" 결과는 PostgreSQL의 Incident/IncidentEvent 스키마에
그대로 대응한다 (scenario_db_id=matched_scenario_rule_id, correlation_key_type/
join_key=Incident의 correlation_key_type/correlation_key_value, events=IncidentEvent
행들).
"""
import json
from typing import Any, Dict, List, Optional

from app.schemas import NormalizedEvent


def _join_key(event: NormalizedEvent, join_on: str) -> Optional[str]:
    if join_on == "pod":
        return event.orchestrator_resource_name
    if join_on == "user_or_sa":
        return event.user_name
    if join_on == "source_ip":
        return event.source_ip
    return None


def _matches(event: NormalizedEvent, pattern: Dict[str, Any]) -> bool:
    """pattern의 조건을 전부 만족하면 True. 지원 키: event_module, event_action,
    min_severity. 시나리오 정의가 늘어나면 여기에 조건 종류를 추가하면 된다."""
    if "event_module" in pattern and event.event_module != pattern["event_module"]:
        return False
    if "event_action" in pattern and event.event_action != pattern["event_action"]:
        return False
    if "min_severity" in pattern and event.event_severity < pattern["min_severity"]:
        return False
    return True


class ScenarioEngine:
    def __init__(self, scenarios: List[Dict[str, Any]], redis_client) -> None:
        self._scenarios = scenarios
        self._redis = redis_client
        # P7-3 헬스 뷰용 결측 카운터. 지금은 in-memory라 재시작하면 0으로 리셋된다 -
        # 영속시키려면 Redis INCR로 바꿀 것.
        self.missing_join_count = 0

    async def evaluate(self, event: NormalizedEvent) -> List[Dict[str, Any]]:
        """이 이벤트로 새로 발화하는 인시던트 목록을 반환 (없으면 빈 리스트)."""
        fired = []
        for scenario in self._scenarios:
            join_key = _join_key(event, scenario["join_on"])
            if join_key is None:
                self.missing_join_count += 1
                continue

            if scenario["type"] == "threshold":
                result = await self._eval_threshold(scenario, event, join_key)
            else:
                result = await self._eval_sequence(scenario, event, join_key)

            if result:
                fired.append(result)
        return fired

    def _fired_result(
        self, scenario: Dict[str, Any], join_key: str, events: List[Dict[str, str]]
    ) -> Dict[str, Any]:
        return {
            "scenario_db_id": scenario["db_id"],
            "scenario_name": scenario["name"],
            "correlation_key_type": scenario["correlation_key_type"],
            "join_key": join_key,
            "severity": scenario.get("severity", 1),
            "mitre_technique_id": scenario.get("mitre_technique_id"),
            "events": events,
        }

    async def _eval_threshold(
        self, scenario: Dict[str, Any], event: NormalizedEvent, join_key: str
    ) -> Optional[Dict[str, Any]]:
        if not _matches(event, scenario.get("match", {})):
            return None

        scenario_id = scenario["id"]
        count_key = f"corr:{scenario_id}:count:{join_key}"
        cooldown_key = f"corr:{scenario_id}:cooldown:{join_key}"

        if await self._redis.get(cooldown_key):
            return None  # 쿨다운 중 - 재발화 안 함

        count = await self._redis.incr(count_key)
        if count == 1:
            await self._redis.expire(count_key, scenario["window_seconds"])

        if count < scenario["threshold"]:
            return None

        await self._redis.delete(count_key)
        await self._redis.set(
            cooldown_key, "1", ex=scenario.get("cooldown_seconds", scenario["window_seconds"])
        )

        return self._fired_result(
            scenario, join_key, [{"event_id": event.event_id, "event_module": event.event_module}]
        )

    async def _eval_sequence(
        self, scenario: Dict[str, Any], event: NormalizedEvent, join_key: str
    ) -> Optional[Dict[str, Any]]:
        scenario_id = scenario["id"]
        state_key = f"corr:{scenario_id}:stage1:{join_key}"

        if _matches(event, scenario["stage1"]):
            # stage1 최신 덮어쓰기: 이미 대기 중이어도 그냥 새로 SET.
            stage1_state = json.dumps(
                {"event_id": event.event_id, "event_module": event.event_module}
            )
            await self._redis.set(state_key, stage1_state, ex=scenario["window_seconds"])
            return None

        if _matches(event, scenario["stage2"]):
            stage1_raw = await self._redis.get(state_key)
            if not stage1_raw:
                return None  # stage1 없이 stage2만 온 경우 - 시퀀스 미완성, 발화 안 함

            await self._redis.delete(state_key)
            stage1_state = json.loads(stage1_raw)
            return self._fired_result(
                scenario,
                join_key,
                [
                    stage1_state,
                    {"event_id": event.event_id, "event_module": event.event_module},
                ],
            )

        return None
