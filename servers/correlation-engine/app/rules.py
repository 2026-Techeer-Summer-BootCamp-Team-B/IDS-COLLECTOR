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


def _match_value(actual: Optional[str], allowed: Any) -> bool:
    if isinstance(allowed, list):
        return actual in allowed
    return actual == allowed


def _match_any_flag(actual_flags: Optional[List[str]], wanted: Any) -> bool:
    """actual_flags(리스트 필드) 중 wanted에 있는 값이 하나라도 있으면 True.
    audit_role_rule_flags_any/audit_pod_security_flags_any가 공유하는 로직."""
    flags = actual_flags or []
    wanted = wanted if isinstance(wanted, list) else [wanted]
    return any(flag in flags for flag in wanted)


def _matches(event: NormalizedEvent, pattern: Dict[str, Any]) -> bool:
    """pattern의 조건을 전부 만족하면 True. 지원 키: event_module, event_action,
    audit_verb, orchestrator_resource_type, orchestrator_namespace, user_name,
    event_outcome(전부 단일 값 또는 값 리스트 가능 - 여러 verb/resource 조합을 하나의
    스테이지로 묶을 때 리스트를 쓴다, 예: S2의 secrets get/list, S1/S3의 RBAC verb x
    resource, S6/S7의 시스템 네임스페이스 SA 생성, S9의 익명 요청 성공),
    orchestrator_resource_name_prefix(리스트 불가, 단일 접두어 문자열만 - S11의
    system: 프리픽스 룰 변조 감지), audit_role_rule_flags_any(event.audit_role_rule_flags
    리스트 중 하나라도 있으면 True - S12의 위험한 RBAC 룰 생성 감지),
    audit_binding_role_name(단일 값 또는 리스트 - S13의 cluster-admin 바인딩 감지),
    audit_pod_security_flags_any(event.audit_pod_security_flags 리스트 중 하나라도
    있으면 True - S16의 pod 탈옥 벡터 감지), audit_service_type(단일 값 또는 리스트 -
    S17의 NodePort Service 노출 감지), audit_configmap_has_credentials(불리언 -
    S18의 평문 자격증명 감지), min_severity. 시나리오 정의가 늘어나면 여기에 조건
    종류를 추가하면 된다."""
    if "event_module" in pattern and event.event_module != pattern["event_module"]:
        return False
    if "event_action" in pattern and not _match_value(event.event_action, pattern["event_action"]):
        return False
    if "audit_verb" in pattern and not _match_value(event.audit_verb, pattern["audit_verb"]):
        return False
    if "orchestrator_resource_type" in pattern and not _match_value(
        event.orchestrator_resource_type, pattern["orchestrator_resource_type"]
    ):
        return False
    if "orchestrator_namespace" in pattern and not _match_value(
        event.orchestrator_namespace, pattern["orchestrator_namespace"]
    ):
        return False
    if "user_name" in pattern and not _match_value(event.user_name, pattern["user_name"]):
        return False
    if "event_outcome" in pattern and not _match_value(event.event_outcome, pattern["event_outcome"]):
        return False
    if "orchestrator_resource_name_prefix" in pattern and not (
        event.orchestrator_resource_name or ""
    ).startswith(pattern["orchestrator_resource_name_prefix"]):
        return False
    if "audit_role_rule_flags_any" in pattern and not _match_any_flag(
        event.audit_role_rule_flags, pattern["audit_role_rule_flags_any"]
    ):
        return False
    if "audit_binding_role_name" in pattern and not _match_value(
        event.audit_binding_role_name, pattern["audit_binding_role_name"]
    ):
        return False
    if "audit_pod_security_flags_any" in pattern and not _match_any_flag(
        event.audit_pod_security_flags, pattern["audit_pod_security_flags_any"]
    ):
        return False
    if "audit_service_type" in pattern and not _match_value(
        event.audit_service_type, pattern["audit_service_type"]
    ):
        return False
    if "audit_configmap_has_credentials" in pattern and not _match_value(
        event.audit_configmap_has_credentials, pattern["audit_configmap_has_credentials"]
    ):
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
