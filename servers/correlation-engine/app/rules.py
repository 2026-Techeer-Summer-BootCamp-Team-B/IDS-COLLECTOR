"""시나리오 룰 실행기 (P4-1, P4-3). sequence/threshold 2타입.

sequence: stage1 패턴이 매칭되면 join_key별로 "stage1 대기중" 상태(이벤트 id+모듈)를
          Redis에 TTL=window_seconds로 기록한다. 그 안에 stage2 패턴이 매칭되면 발화.
          stage1이 대기 중에 또 매칭되면 최신 것으로 덮어쓴다 (stage1 최신 덮어쓰기).

threshold: join_key별 매칭 카운터를 Redis에 TTL=window_seconds로 유지한다. count가
           threshold 이상이면 발화 -> 카운터 리셋 + 쿨다운 키를 세팅해서 쿨다운
           기간 동안 새 인시던트 발화(카운터/쿨다운 TTL 갱신)는 막는다. 다만 쿨다운
           중에도 같은 공격이 계속 들어오면 매번 발화 결과를 반환해서
           incidents.upsert_incident가 여전히 open인 그 인시던트에 이벤트를 추가하고
           updated_at을 갱신하게 한다 - 그래야 목록(최신순)에서 계속 맨 위에 남는다.

join_key가 없는 이벤트(join_on 필드가 비어있는 경우)는 상관에서 제외하고 결측
카운터만 올린다 (파이프라인 헬스 뷰 P7-3에서 노출).

evaluate()가 반환하는 "발화" 결과는 PostgreSQL의 Incident/IncidentEvent 스키마에
그대로 대응한다 (scenario_db_id=matched_scenario_rule_id, correlation_key_type/
join_key=Incident의 correlation_key_type/correlation_key_value, events=IncidentEvent
행들).
"""
import ipaddress
import json
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

from ids_shared.schemas import NormalizedEvent


def _join_key(event: NormalizedEvent, join_on: str) -> Optional[str]:
    if join_on == "pod":
        return event.orchestrator_resource_name
    if join_on == "user_or_sa":
        return event.user_name
    if join_on == "source_ip":
        return event.source_ip
    return None


# 인자 순서는 항상 (actual, expected/allowed) - normalizer/app/severity.py의 동명 함수와
# 반드시 맞출 것(그쪽도 이 순서로 통일함). NormalizedEvent 스키마는 ids_shared 패키지로
# 공유하지만, 이 매칭 로직은 severity.py가 raw payload(dict)를 보고 여기는
# NormalizedEvent(pydantic 모델)를 보는 거라 입력 형태가 달라 그대로 복제해서 쓴다 -
# 인자 순서가 서로 다르면 한쪽 코드를 보고 다른 쪽에 옮겨 적을 때 순서를 반대로 넣는
# 실수가 나기 쉽다.
def _match_value(actual: Optional[str], allowed: Any) -> bool:
    if isinstance(allowed, list):
        return actual in allowed
    return actual == allowed


def _match_any_flag(actual_flags: Optional[List[str]], wanted: Any) -> bool:
    """actual_flags(리스트 필드) 중 wanted에 있는 값이 하나라도 있으면 True.
    audit_role_rule_flags_any/audit_pod_security_flags_any가 공유하는 로직.
    normalizer/app/severity.py의 동명 함수와 인자 순서를 반드시 맞출 것."""
    flags = actual_flags or []
    wanted = wanted if isinstance(wanted, list) else [wanted]
    return any(flag in flags for flag in wanted)


def _match_prefix(actual: Optional[str], prefix: str) -> bool:
    return (actual or "").startswith(prefix)


def _match_min_severity(actual: int, minimum: int) -> bool:
    return actual >= minimum


# (pattern 키, NormalizedEvent 속성명, 매처) 테이블. 시나리오에 새 조건이 필요하면
# _matches()를 고칠 필요 없이 여기에 행 하나만 추가하면 된다 - 매처 3종류:
#   _match_value    단일 값 또는 값 리스트(둘 다 pattern 쪽에 올 수 있음, 예: S2의
#                   secrets get/list, S1/S3의 RBAC verb x resource)
#   _match_any_flag 이벤트 쪽이 리스트 필드일 때, pattern에 있는 값이 하나라도
#                   있으면 매치(audit_*_any 이름이 붙은 것 + requestObject가 JSON
#                   Patch 배열이라 리스트로 나오는 audit_binding_role_name/
#                   audit_service_type)
#   _match_prefix/_match_min_severity  각각 S11(system: 프리픽스 룰 변조), 최소
#                   심각도 필터용 단일 목적 매처
_MATCHERS: List[Tuple[str, str, Callable[[Any, Any], bool]]] = [
    ("event_module", "event_module", _match_value),
    ("event_action", "event_action", _match_value),
    ("audit_verb", "audit_verb", _match_value),
    ("orchestrator_resource_type", "orchestrator_resource_type", _match_value),
    ("orchestrator_namespace", "orchestrator_namespace", _match_value),
    ("user_name", "user_name", _match_value),
    ("event_outcome", "event_outcome", _match_value),
    ("orchestrator_resource_name_prefix", "orchestrator_resource_name", _match_prefix),
    # S19(로그인 브루트포스) 재료 - WAS 원본 access log의 요청 경로/메서드/응답
    # 코드로 "로그인 실패"를 판정한다. url_path_prefix는 orchestrator_resource_name_prefix와
    # 같은 이유로 접두사 매칭(정확한 로그인 엔드포인트 하위 경로까지 허용).
    ("url_path_prefix", "url_path", _match_prefix),
    ("http_request_method", "http_request_method", _match_value),
    ("http_response_status_code", "http_response_status_code", _match_value),
    ("audit_role_rule_flags_any", "audit_role_rule_flags", _match_any_flag),
    ("audit_binding_role_name", "audit_binding_role_name", _match_any_flag),
    ("audit_pod_security_flags_any", "audit_pod_security_flags", _match_any_flag),
    ("audit_service_type", "audit_service_type", _match_any_flag),
    ("audit_configmap_has_credentials", "audit_configmap_has_credentials", _match_value),
    ("audit_ingress_has_tls", "audit_ingress_has_tls", _match_value),
    ("min_severity", "event_severity", _match_min_severity),
]


def _matches(event: NormalizedEvent, pattern: Dict[str, Any]) -> bool:
    """pattern에 있는 키의 조건을 전부 만족하면 True(pattern에 없는 키는 검사하지
    않음). 지원 키/매칭 방식은 _MATCHERS 참고."""
    return all(
        matcher(getattr(event, event_attr), pattern[pattern_key])
        for pattern_key, event_attr, matcher in _MATCHERS
        if pattern_key in pattern
    )


class ScenarioEngine:
    def __init__(self, scenarios: List[Dict[str, Any]], redis_client) -> None:
        self._scenarios = scenarios
        self._redis = redis_client
        # P7-3 헬스 뷰용 결측 카운터. 지금은 in-memory라 재시작하면 0으로 리셋된다 -
        # 영속시키려면 Redis INCR로 바꿀 것.
        self.missing_join_count = 0
        # allow_list 캐시(app/main.py의 주기 리프레시가 set_allow_list()로 갱신) -
        # (network, target_name) 튜플 목록. target_name이 None이면 전역(모든
        # 타깃에 적용) 항목. ip_or_cidr 문자열은 미리 ipaddress 객체로 파싱해둬서
        # 이벤트마다 문자열 파싱을 반복하지 않는다.
        self._allow_list: List[
            Tuple[Union[ipaddress.IPv4Network, ipaddress.IPv6Network], Optional[str]]
        ] = []

    def set_allow_list(self, entries: List[Dict[str, Optional[str]]]) -> None:
        """allow_list 전체(전역 + target_name으로 스코프된 항목)를 반영한다 -
        entries는 incidents.fetch_active_allow_list()가 만든
        [{ip_or_cidr, target_name}] 형태(target 테이블과 이미 JOIN돼서 이름으로
        나옴). 파싱 실패한 항목(잘못된 CIDR 등)은 조용히 건너뛴다 - 입력 검증은
        platform-api의 allow_list_api.py 책임."""
        parsed = []
        for entry in entries:
            try:
                network = ipaddress.ip_network(entry["ip_or_cidr"], strict=False)
            except ValueError:
                continue
            parsed.append((network, entry.get("target_name")))
        self._allow_list = parsed

    def _is_allow_listed(self, source_ip: Optional[str], target_name: Optional[str]) -> bool:
        if not source_ip or not self._allow_list:
            return False
        try:
            ip = ipaddress.ip_address(source_ip)
        except ValueError:
            return False
        return any(
            ip in network and (entry_target is None or entry_target == target_name)
            for network, entry_target in self._allow_list
        )

    async def evaluate(self, event: NormalizedEvent) -> List[Dict[str, Any]]:
        """이 이벤트로 새로 발화하는 인시던트 목록을 반환 (없으면 빈 리스트).

        event.source_ip가 allow_list에 있으면(전역 항목, 또는 event.target_name과
        일치하는 target_name으로 스코프된 항목) 어느 시나리오와도 상관분석
        대상으로 삼지 않는다 - "이 발신지는 (이 타깃 기준으로) 신뢰됨"이라는
        판단이므로 join_on이 source_ip가 아닌 시나리오(pod/user_or_sa 기준)에도
        동일하게 적용한다(예: 신뢰된 스캐너가 우연히 다른 상관 축으로도 튀는 걸
        막음). was/waf가 아닌 이벤트(falco/k8s_audit)는 event.target_name이
        항상 None이라, target_name으로 스코프된 항목은 이런 이벤트에 적용되지
        않는다(전역 항목만 적용됨) - 애초에 falco/k8s_audit은 특정 앱이 아니라
        클러스터 단위 이벤트라 "이 타깃에서 온 트래픽" 개념 자체가 없다. 원본
        로그 자체는 정규화/저장 단계에서 이미 끝나 있어 여기서 걸러도 raw
        조회/포렌식에는 영향 없다 - 상관분석(인시던트 발화)만 면제된다.

        scenario["required_modules"]에 이 이벤트의 event_module이 없으면 애초에
        무관한 시나리오라 _matches()까지 가지 않고 건너뛴다 - 예전엔 이 필터가
        없어서 was/waf/falco 이벤트도 k8s_audit 전용 시나리오(S12 등)의 match
        조건까지 평가했다. NormalizedEvent에 그 시나리오가 쓰는 필드(예:
        audit_role_rule_flags)가 없던 시절엔 이게 매 이벤트마다 AttributeError로
        evaluate() 전체를 죽이는 사고로 이어졌다 - 스키마 드리프트가 고쳐진 지금도
        애초에 관련 없는 시나리오를 평가하는 건 낭비라 필터는 남겨둔다.

        Redis 키 scenario:enabled:{db_id}가 정확히 "0"이면 이 시나리오는 건너뛴다 -
        platform-api의 PATCH /scenarios/{id}/enabled가 Postgres와 함께 이 키를
        SET한다(app/main.py가 엔진 기동 시 Postgres 값으로 시드도 함). 키가 없거나
        "1"이면 평가 진행 - 새로 추가된 시나리오가 기본 활성 상태인 것과 같은
        fail-open 기본값이다."""
        if self._is_allow_listed(event.source_ip, event.target_name):
            return []

        fired = []
        for scenario in self._scenarios:
            if event.event_module not in scenario["required_modules"]:
                continue

            if await self._redis.get(f"scenario:enabled:{scenario['db_id']}") == "0":
                continue

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
            # 쿨다운 중엔 새 인시던트를 만들거나 카운터/쿨다운 TTL을 건드리지 않지만,
            # 그렇다고 아무 것도 안 하면 같은 공격이 계속 들어와도 이미 만든 인시던트가
            # incidents.upsert_incident의 open 병합 로직을 탈 기회 자체가 없어져서
            # incident_events에 안 쌓이고 updated_at도 안 갱신된다 - 목록이 최신순
            # 정렬이라 "예전 공격이 또 오면 맨 위로 와야 하는데 안 올라온다"는 증상으로
            # 보인다(2026-07-15, 실측 확인). 그래서 여기서도 발화 결과를 계속 반환해서
            # upsert_incident가 (scenario, join_key)로 여전히 open/investigating인 그
            # 인시던트를 찾아 이벤트만 추가 + updated_at을 갱신하게 한다 - 이미
            # closed로 넘어간(=해결 완료) 인시던트라면 upsert_incident가 알아서 새
            # 인시던트를 만든다.
            return self._fired_result(
                scenario, join_key, [{"event_id": event.event_id, "event_module": event.event_module}]
            )

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
