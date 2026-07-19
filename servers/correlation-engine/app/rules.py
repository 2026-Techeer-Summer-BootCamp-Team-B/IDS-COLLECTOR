"""시나리오 룰 실행기 (P4-1, P4-3). sequence/threshold 2타입.

sequence: stage1, stage2, stage3, ... 임의 개수의 단계를 순서대로 상관(2026-07-19,
          예전엔 stage1/stage2 딱 2단계로 하드코딩돼 있었다 - 지금은 시나리오
          YAML에 stageN 키를 몇 개를 쓰든 _stage_patterns()가 숫자 순서대로 전부
          주워 모아서 그만큼의 단계로 평가한다. 최소 2단계(stage1/stage2)는 여전히
          필수고 - test_scenario_catalog.py가 강제 - 그 이상은 이 파일을 고칠 필요
          없이 YAML에 stage3, stage4, stage5, ...를 계속 추가하기만 하면 된다).
          stage1 패턴이 매칭되면 join_key별로 "진행 중" 상태(지금까지 매칭된 이벤트
          목록 + 다음 기다리는 단계 인덱스)를 Redis에 TTL=window_seconds로 기록한다.
          그 뒤 "바로 다음 단계"의 패턴과 매칭되는 이벤트가 오면 한 칸씩 전진하고,
          마지막 단계까지 도달하면 발화한다. stage1이 다시 매칭되면(진행 중이든
          아니든) 그 시점부터 최신 것으로 덮어쓴다(stage1 최신 덮어쓰기) - 중간
          단계를 건너뛰고 나중 단계 패턴만 오는 경우는 시퀀스 미완성으로 무시한다.
          window_seconds는 체인 전체(stage1 최초 매칭 ~ 마지막 단계 완료)에 적용되는
          예산이다 - 중간 단계를 지날 때는 KEEPTTL로 값만 갱신해서 마감시한 자체는
          늘리지 않는다(안 그러면 체인이 길어질수록 전체 허용 시간이 단계 수만큼
          늘어나 버려 "이 공격 전체가 window_seconds 안에 다 일어났다"는 의미가
          깨진다).

threshold: join_key별 매칭 카운터를 Redis에 TTL=window_seconds로 유지한다. count가
           threshold 이상이면 발화 -> 카운터 리셋 + 쿨다운 키를 세팅해서 쿨다운
           기간 동안 새 인시던트 발화(카운터/쿨다운 TTL 갱신)는 막는다. 다만 쿨다운
           중에도 같은 공격이 계속 들어오면 매번 발화 결과를 반환해서
           incidents.upsert_incident가 여전히 open인 그 인시던트에 이벤트를 추가하고
           updated_at을 갱신하게 한다 - 그래야 목록(최신순)에서 계속 맨 위에 남는다.

cardinality (2026-07-19): join_key별로 어떤 필드(distinct_field)의 "서로 다른 값
           개수"가 threshold 이상이면 발화한다 - 예: 같은 IP가 서로 다른 URL을
           threshold개 이상 두드림(반복이 아니라 다양성이 신호인 정찰 탐지, 여러
           계층 시나리오 Notion 페이지의 M4/M10). threshold(INCR 카운터)와 값
           집합을 Redis SET(SADD/SCARD)으로 유지한다는 것만 다르고, 윈도우/쿨다운
           규칙은 threshold와 동일하다.

join_key가 없는 이벤트(join_on 필드가 비어있는 경우)는 상관에서 제외하고 결측
카운터만 올린다 (파이프라인 헬스 뷰 P7-3에서 노출).

absent_recent_module (2026-07-19, "동시 부재" 확인): match(threshold/cardinality)
           또는 stageN(sequence) 패턴에 이 키를 추가하면, "이 패턴이 매칭되는 순간
           지정된 모듈이 같은 join_key로 최근(기본값: 이 시나리오의 window_seconds,
           override는 absent_recent_seconds) 발생한 적이 없어야" 이 패턴을 매칭으로
           친다 - 여러 계층 시나리오 Notion 페이지의 M9("K8s Audit 비인가 이미지
           pull + Falco 악성 패턴 + WAF/WAS 트래픽 없음 = 공급망 침해 정황")처럼
           "이 사건이 났을 때 다른 소스가 최근에 조용했는가"를 보는 동시성 부재
           체크다. evaluate()가 매 이벤트마다 무조건 _stamp_recency()로 "이
           모듈·이 join_key가 방금 나타났다"는 흔적을 Redis에 남겨두므로(어느
           시나리오가 나중에 이 흔적을 쓸지 몰라 pod/user_or_sa/source_ip 3개 축
           전부에 미리 남긴다), 패턴 평가 시 그 흔적의 최신 여부만 확인하면 되고
           미래를 기다리는 스케줄러가 필요 없다. ⚠️ 이건 동시 부재만 본다 - "stage1
           이후 N초 안에 아무 일도 안 일어나면 발화"처럼 미래 시간 경과 자체를
           기다려야 하는 지연 부재는 이 메커니즘으로 못 한다(별도 스케줄러 필요,
           아직 미구현).

evaluate()가 반환하는 "발화" 결과는 PostgreSQL의 Incident/IncidentEvent 스키마에
그대로 대응한다 (scenario_db_id=matched_scenario_rule_id, correlation_key_type/
join_key=Incident의 correlation_key_type/correlation_key_value, events=IncidentEvent
행들).
"""
import ipaddress
import json
import re
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

from ids_shared.schemas import NormalizedEvent


# "동시 부재"(absent_recent_module) 마커의 절대 상한 TTL - absent_recent_seconds(또는
# window_seconds 기본값)가 이 값을 넘으면 마커가 그 전에 먼저 Redis에서 사라져 실제로는
# 있었는데 "부재"로 오판할 수 있다. test_scenario_catalog.py가 카탈로그 로드 단계에서
# 이 상한을 강제한다.
_RECENCY_MARKER_TTL_SECONDS = 900

# _stamp_recency()가 매 이벤트마다 흔적을 남기는 join_on 축 전체 - 어떤 시나리오가
# 나중에 absent_recent_module로 이 이벤트의 부재를 어느 축으로 물어볼지 미리 알 수
# 없어서, 값이 있는 축 전부에 남긴다(_join_key 참고).
_JOIN_ON_KINDS: Tuple[str, ...] = ("pod", "user_or_sa", "source_ip")


def _join_key(event: NormalizedEvent, join_on: str) -> Optional[str]:
    if join_on == "pod":
        return event.orchestrator_resource_name
    if join_on == "user_or_sa":
        # actor_identity 우선(2026-07-19) - enrichment.py가 was/waf/falco 이벤트에
        # "이 대상 pod에 바인딩된 K8s 신원"을 채워 넣은 값. k8s_audit은 이 필드를 안
        # 채우고 user_name(실제 인증된 신원)만 채우므로 한 이벤트에 둘 다 있는 경우는
        # 없다 - 이렇게 하나의 join_on=user_or_sa로 WAF/Falco(대상 pod 단위)와
        # k8s_audit(그 pod가 훔친 토큰으로 실제 호출한 신원)까지 체인이 끊기지 않고
        # 이어진다(schemas.py의 actor_identity 필드 주석 참고).
        return event.actor_identity or event.user_name
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


_STAGE_KEY_RE = re.compile(r"^stage(\d+)$")


def _stage_patterns(scenario: Dict[str, Any]) -> List[Dict[str, Any]]:
    """sequence 시나리오의 stage1, stage2, stage3, ...를 숫자 순서대로 전부 뽑아
    리스트로 반환한다 - 단계 수에 상한을 두지 않는다. 나중에 5단계, 6단계짜리
    시나리오가 필요해져도 YAML에 stage5, stage6, ...만 추가하면 되고 이 함수는
    손댈 필요가 없다(2026-07-19). stage1/stage2 필수, 번호 연속성(건너뛴 번호가
    없어야 함)은 카탈로그 무결성 테스트(test_scenario_catalog.py)가 로드 단계에서
    강제한다 - 여기서는 신뢰하고 그냥 숫자 순으로 정렬만 한다."""
    numbered = [
        (int(m.group(1)), pattern)
        for key, pattern in scenario.items()
        if (m := _STAGE_KEY_RE.match(key))
    ]
    numbered.sort(key=lambda pair: pair[0])
    return [pattern for _, pattern in numbered]


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

    def set_scenarios(self, scenarios: List[Dict[str, Any]]) -> None:
        """app/main.py의 _scenario_reload_loop가 주기적으로 다시 읽은
        app/scenarios/*.yaml 결과로 평가 대상 목록을 교체한다 - 예전엔 엔진
        기동 시 한 번만 읽어서 시나리오를 추가/수정하려면 재배포가 필요했다
        (2026-07-15). Redis에 쌓인 진행 중 상태(corr:{scenario_id}:*, threshold
        카운터/쿨다운/sequence stage1 대기)는 scenario_id가 안 바뀌는 한 그대로
        유효하다 - 교체 도중 평가와 겹쳐도 self._scenarios를 새 리스트로 통째로
        바꿔치기할 뿐이라(원소를 하나씩 변경하지 않음) 이 대입 자체는 원자적이다."""
        self._scenarios = scenarios

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

    async def _stamp_recency(self, event: NormalizedEvent) -> None:
        """이 이벤트가 나중에 다른 시나리오의 absent_recent_module 조건에서 조회될
        수 있도록, 값이 있는 모든 join_on 축(pod/user_or_sa/source_ip)으로 "최근
        발생" 흔적을 Redis에 남긴다. 어떤 시나리오가 나중에 이 모듈의 부재를 어느
        축으로 물어볼지 미리 알 수 없어 3개 축 전부를 싼 비용(SET 최대 3개, 값 없는
        축은 스킵)으로 남겨둔다. 값은 이벤트의 실제 발생 시각(timestamp, 수신 시각인
        event_ingested가 아니다)이라 나중에 조회하는 쪽이 "그때로부터 몇 초가
        지났는지"를 정확히 계산할 수 있다 - TTL(_RECENCY_MARKER_TTL_SECONDS)은 그
        계산이 가능하도록 값을 충분히 오래 살려두는 상한일 뿐이다.

        allow_list로 상관분석 자체가 면제되는 이벤트도 여기는 통과한다(evaluate()가
        이 호출을 allow_list 체크보다 앞에 둠) - "신뢰된 IP라 인시던트는 안 만들되,
        그 소스에서 트래픽이 있었다는 사실 자체"는 M9류 부재 확인에 여전히 유효한
        정보이기 때문이다(신뢰된 헬스체커 트래픽도 "이 pod로 외부 트래픽이 아예
        없었다"를 반증하는 증거로는 유효)."""
        for join_on in _JOIN_ON_KINDS:
            key = _join_key(event, join_on)
            if key is None:
                continue
            await self._redis.set(
                f"seen:{event.event_module}:{join_on}:{key}",
                str(event.timestamp.timestamp()),
                ex=_RECENCY_MARKER_TTL_SECONDS,
            )

    async def _passes_absent_recent(
        self, pattern: Dict[str, Any], scenario: Dict[str, Any], join_key: str, now_ts: float
    ) -> bool:
        """pattern에 absent_recent_module이 없으면 그냥 통과. 있으면 _stamp_recency()가
        남긴 흔적으로 "지정된 모듈이 같은 join_key·join_on 축으로 최근(기본값: 이
        시나리오의 window_seconds, override는 absent_recent_seconds) 발생했는지"를
        확인해서, 발생했으면(=부재 조건 불성립) False를 돌려준다."""
        modules = pattern.get("absent_recent_module")
        if not modules:
            return True
        if isinstance(modules, str):
            modules = [modules]
        seconds = pattern.get("absent_recent_seconds", scenario["window_seconds"])
        join_on = scenario["join_on"]
        for module in modules:
            raw = await self._redis.get(f"seen:{module}:{join_on}:{join_key}")
            if raw is not None and (now_ts - float(raw)) <= seconds:
                return False
        return True

    async def _stage_matches(
        self, event: NormalizedEvent, pattern: Dict[str, Any], scenario: Dict[str, Any], join_key: str
    ) -> bool:
        """구조적 조건(_matches, 동기)과 "동시 부재" 조건(absent_recent_module, Redis
        조회가 필요해 비동기)을 합쳐서 판단한다 - threshold의 match, sequence의
        stageN, cardinality의 match가 전부 이 경로를 탄다(_matches를 직접 부르지
        않는다)."""
        if not _matches(event, pattern):
            return False
        return await self._passes_absent_recent(pattern, scenario, join_key, event.timestamp.timestamp())

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
        fail-open 기본값이다.

        가장 먼저 _stamp_recency()로 이 이벤트의 "최근 발생" 흔적을 남긴다 - 어느
        시나리오와도 매칭 여부와 무관하게, 심지어 allow_list로 이후 상관분석이
        면제되는 이벤트여도 남긴다(다른 시나리오의 absent_recent_module 조건이
        나중에 참조할 수 있어야 하므로 이 시점에 먼저 실행)."""
        await self._stamp_recency(event)

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
            elif scenario["type"] == "cardinality":
                result = await self._eval_cardinality(scenario, event, join_key)
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
        if not await self._stage_matches(event, scenario.get("match", {}), scenario, join_key):
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

    async def _eval_cardinality(
        self, scenario: Dict[str, Any], event: NormalizedEvent, join_key: str
    ) -> Optional[Dict[str, Any]]:
        """join_key별로 distinct_field 값의 "서로 다른 개수"가 threshold 이상이면
        발화 - threshold(단순 건수)와 달리 같은 값이 반복돼도 카운트가 안 오른다
        (예: 같은 URL을 계속 두드리는 건 재시도일 수 있어서 무시하고, 서로 다른
        URL이 늘어야 정찰로 친다). Redis SET(SADD/SCARD)으로 distinct 값 집합을
        유지한다는 것만 빼면 _eval_threshold와 창/쿨다운 규칙이 완전히 동일해서
        그 주석을 반복하지 않는다."""
        if not await self._stage_matches(event, scenario.get("match", {}), scenario, join_key):
            return None

        value = getattr(event, scenario["distinct_field"], None)
        if value is None:
            return None  # 셀 값 자체가 없는 이벤트는 무시(예: url_path 없는 이벤트)

        scenario_id = scenario["id"]
        set_key = f"corr:{scenario_id}:distinct:{join_key}"
        cooldown_key = f"corr:{scenario_id}:cooldown:{join_key}"

        if await self._redis.get(cooldown_key):
            # _eval_threshold와 동일한 이유 - 쿨다운 중에도 발화 결과를 계속 반환해서
            # 여전히 open인 인시던트가 갱신되게 한다.
            return self._fired_result(
                scenario, join_key, [{"event_id": event.event_id, "event_module": event.event_module}]
            )

        await self._redis.sadd(set_key, value)
        count = await self._redis.scard(set_key)
        if count == 1:
            await self._redis.expire(set_key, scenario["window_seconds"])

        if count < scenario["threshold"]:
            return None

        await self._redis.delete(set_key)
        await self._redis.set(
            cooldown_key, "1", ex=scenario.get("cooldown_seconds", scenario["window_seconds"])
        )

        return self._fired_result(
            scenario, join_key, [{"event_id": event.event_id, "event_module": event.event_module}]
        )

    async def _eval_sequence(
        self, scenario: Dict[str, Any], event: NormalizedEvent, join_key: str
    ) -> Optional[Dict[str, Any]]:
        """stage1, stage2, ... 임의 개수의 순차 상관(최소 2단계). _stage_patterns()가
        뽑아주는 순서 리스트를 기준으로, 진행 상태(progress = 지금까지 매칭된 단계 수)를
        Redis에 들고 있다가 다음 단계가 오면 전진시킨다 - 리스트 길이가 곧 이 시나리오의
        단계 수라 이 함수 자체는 몇 단계든 그대로 처리한다."""
        stages = _stage_patterns(scenario)
        scenario_id = scenario["id"]
        state_key = f"corr:{scenario_id}:stage:{join_key}"

        if await self._stage_matches(event, stages[0], scenario, join_key):
            # stage1 최신 덮어쓰기: 진행 중이던 체인이 있어도 버리고 이 이벤트부터
            # 새로 시작 - 2단계 시절 동작을 그대로 일반화.
            state = {
                "progress": 1,
                "events": [{"event_id": event.event_id, "event_module": event.event_module}],
            }
            await self._redis.set(state_key, json.dumps(state), ex=scenario["window_seconds"])
            return None

        raw = await self._redis.get(state_key)
        if not raw:
            return None  # stage1 없이 중간/마지막 단계만 온 경우 - 시퀀스 미완성, 무시

        state = json.loads(raw)
        progress = state["progress"]
        if progress >= len(stages) or not await self._stage_matches(
            event, stages[progress], scenario, join_key
        ):
            return None  # "바로 다음" 단계가 아니면(순서를 건너뛴 경우 포함) 무시 - 기존 진행 상태 유지

        state["events"].append({"event_id": event.event_id, "event_module": event.event_module})
        progress += 1

        if progress == len(stages):
            await self._redis.delete(state_key)
            return self._fired_result(scenario, join_key, state["events"])

        state["progress"] = progress
        # KEEPTTL - 값(진행 상태)만 갱신하고 stage1이 최초로 세팅한 마감시한은
        # 그대로 둔다(모듈 docstring 참고).
        await self._redis.set(state_key, json.dumps(state), keepttl=True)
        return None
