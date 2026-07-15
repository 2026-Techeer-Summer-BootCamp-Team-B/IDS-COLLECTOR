"""exclusion_rules(파이프라인 노이즈 제외 규칙) 매칭 + Postgres 캐시.

exclusion_rules.pattern은 사람이 미리 큐레이션해둔 "이건 노이즈다"라는 판단을
담은 작은 DSL 문자열이다(예: `verb IN (get, watch) AND user =~
"system:serviceaccount:.*"`) - AND로 묶인 조건들이고, 조건 하나는 다음 셋 중
하나다:
  field="value"        (정확히 일치, 따옴표 없어도 됨: field=value)
  field IN (a, b, c)    (목록에 포함)
  field =~ "regex"      (정규식 매칭)

이 모듈은 그 판단을 "실행"하지 않는다(=새 노이즈를 찾지 않는다) - 이미 admin이
enabled=true로 큐레이션해둔 규칙을 NormalizedEvent 필드와 기계적으로 비교만
한다. field는 DSL에서 사람이 쓰는 이름이고 _FIELD_TO_ATTR로 실제
NormalizedEvent 속성에 대응시킨다 - 매핑에 없는 필드(예: EX-04의 level/source -
지금 normalize_falco()가 채우지 않는 필드)를 참조하는 규칙은 항상 불일치로
안전하게 처리한다(그 규칙만 죽은 채로 남을 뿐 파이프라인 전체엔 영향 없음).

정규분석 hot path(_process_body)에서 매 이벤트마다 Postgres를 치면 지연이
누적되므로, correlation-engine의 allow_list 캐시(app/main.py
_allow_list_refresh_loop)와 동일하게 주기 폴링 + 인메모리 캐시로 뺐다."""
import re
from dataclasses import dataclass
from typing import Dict, List, Optional

from app.db import pool
from ids_shared.schemas import NormalizedEvent

# layer(사람이 읽는 계층 이름, log_policies/exclusion_rules 공통) -> event.module.
# platform-api의 app/log_retention.py와 동일한 매핑 - WAS 레이어는 nginx 액세스
# 로그(was)와 WAF 알림(waf) 둘 다를 가리킨다.
_MODULE_TO_LAYER = {
    "was": "WAS",
    "waf": "WAS",
    "falco": "Falco",
    "k8s_audit": "K8s Audit",
}

_FIELD_TO_ATTR = {
    "rule": "rule_name",
    "verb": "audit_verb",
    "user": "user_name",
    "path": "url_path",
}

_IN_RE = re.compile(r"^\s*(\w+)\s+IN\s*\((.+)\)\s*$")
_COND_RE = re.compile(r'^\s*(\w+)\s*(=~|=)\s*(.+?)\s*$')


@dataclass
class _Condition:
    attr: Optional[str]
    op: str  # "eq" | "in" | "re"
    value: object  # str | set[str] | re.Pattern


@dataclass
class _CompiledRule:
    id: str
    conditions: List[_Condition]

    def matches(self, event: NormalizedEvent) -> bool:
        return all(_eval_condition(event, c) for c in self.conditions)


def _strip_quotes(raw: str) -> str:
    raw = raw.strip()
    if len(raw) >= 2 and raw[0] == '"' and raw[-1] == '"':
        return raw[1:-1]
    return raw


def _parse_condition(raw: str) -> _Condition:
    in_match = _IN_RE.match(raw)
    if in_match:
        field, values = in_match.groups()
        value_set = {v.strip() for v in values.split(",")}
        return _Condition(attr=_FIELD_TO_ATTR.get(field), op="in", value=value_set)

    cond_match = _COND_RE.match(raw)
    if not cond_match:
        raise ValueError(f"파싱 불가능한 exclusion_rules 조건: {raw!r}")
    field, op, value = cond_match.groups()
    attr = _FIELD_TO_ATTR.get(field)
    if op == "=~":
        return _Condition(attr=attr, op="re", value=re.compile(_strip_quotes(value)))
    return _Condition(attr=attr, op="eq", value=_strip_quotes(value))


def _compile_pattern(rule_id: str, pattern: str) -> Optional[_CompiledRule]:
    try:
        conditions = [_parse_condition(part) for part in pattern.split(" AND ")]
    except ValueError as e:
        print(f"[normalizer] exclusion_rules 패턴 파싱 실패, 이 규칙은 건너뜀 - id={rule_id}: {e}")
        return None
    return _CompiledRule(id=rule_id, conditions=conditions)


def _eval_condition(event: NormalizedEvent, condition: _Condition) -> bool:
    if condition.attr is None:
        return False
    value = getattr(event, condition.attr, None)
    if value is None:
        return False
    if condition.op == "eq":
        return str(value) == condition.value
    if condition.op == "in":
        return str(value) in condition.value
    if condition.op == "re":
        return condition.value.search(str(value)) is not None
    return False


_rules_by_layer: Dict[str, List[_CompiledRule]] = {}


def set_rules(rows) -> None:
    """asyncpg Record 목록(id, layer, pattern)을 컴파일해서 캐시에 반영."""
    by_layer: Dict[str, List[_CompiledRule]] = {}
    for row in rows:
        compiled = _compile_pattern(row["id"], row["pattern"])
        if compiled is None:
            continue
        by_layer.setdefault(row["layer"], []).append(compiled)
    global _rules_by_layer
    _rules_by_layer = by_layer


async def refresh_from_db() -> None:
    async with pool().acquire() as conn:
        rows = await conn.fetch("SELECT id, layer, pattern FROM exclusion_rules WHERE enabled = true")
    set_rules(rows)


async def fetch_poll_interval_seconds(key: str, default: int) -> int:
    """poll_intervals 테이블(datastore/postgres/init/013-poll-intervals.sql,
    platform-api의 GET/PATCH /poll-intervals API로 admin이 조절)에서 폴링 주기를
    읽는다. 행이 없으면(마이그레이션 누락 등) default로 fail-open."""
    async with pool().acquire() as conn:
        value = await conn.fetchval("SELECT seconds FROM poll_intervals WHERE key = $1", key)
    return value if value is not None else default


def matched_rule_id(event: NormalizedEvent) -> Optional[str]:
    """event.event_module의 layer에 걸린 활성 규칙 중 이 이벤트와 일치하는 첫
    번째 규칙의 id. 없으면 None(제외 대상 아님)."""
    layer = _MODULE_TO_LAYER.get(event.event_module)
    if layer is None:
        return None
    for rule in _rules_by_layer.get(layer, []):
        if rule.matches(event):
            return rule.id
    return None
