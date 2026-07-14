"""인시던트 API (P5-1). 목록/상세/상태 변경(open→investigating→closed) +
incident_events 서브 리소스 + timeline(스토리라인) 서브 리소스.
datastore/postgres/init/001-schema.sql의 incidents/incident_events/scenario_rules
참고."""
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from app.audit import record_action
from app.auth import current_user_id
from app.config import settings
from app.db import pool
from app.opensearch_client import client as opensearch_client
from app.pagination import decode_cursor, set_next_cursor_header
from app.timeparse import parse_iso8601

router = APIRouter(prefix="/incidents", tags=["incidents"])

_VALID_TRANSITIONS = {
    "open": {"investigating"},
    "investigating": {"closed"},
    "closed": set(),
}


class IncidentOut(BaseModel):
    id: str
    title: str
    correlation_key_type: str
    correlation_key_value: str
    severity: int
    status: str
    matched_scenario_rule_id: Optional[str]
    mitre_tactics: List[str]
    created_at: str
    updated_at: str


class IncidentEventOut(BaseModel):
    event_id: str
    event_module: str
    added_at: str


class StatusUpdate(BaseModel):
    status: str


class TimelineEntryOut(BaseModel):
    event_id: str
    event_module: str
    added_at: str
    title: Optional[str]
    detail: Optional[str]
    mitre_technique_id: Optional[str]


def _client_ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _row_to_incident(row) -> IncidentOut:
    return IncidentOut(
        id=str(row["id"]),
        title=row["title"],
        correlation_key_type=row["correlation_key_type"],
        correlation_key_value=row["correlation_key_value"],
        severity=row["severity"],
        status=row["status"],
        matched_scenario_rule_id=str(row["matched_scenario_rule_id"])
        if row["matched_scenario_rule_id"]
        else None,
        mitre_tactics=row["mitre_tactics"],
        created_at=row["created_at"].isoformat(),
        updated_at=row["updated_at"].isoformat(),
    )


@router.get("", response_model=List[IncidentOut])
async def list_incidents(
    response: Response,
    status: Optional[str] = None,
    since: Optional[str] = None,
    limit: int = 50,
    cursor: Optional[str] = None,
):
    """since(ISO8601)를 주면 그 시각 이후 생성된 인시던트만 오래된순으로 반환한다 -
    프론트가 실시간 CRITICAL 팝업을 WebSocket 대신 이 파라미터로 3~5초 주기 폴링해서
    구현한다(2026-07-13, 마지막으로 확인한 시각을 다음 호출의 since로 그대로 넘기면 됨).
    since가 없는 기본 호출(목록 화면)은 기존대로 최신순.

    limit은 한 페이지 크기다(이전엔 이게 "전체 조회 가능한 최대치"였다 - 2026-07-15
    페이지네이션 추가로 해소). 응답이 꽉 찼으면(=limit건 그대로 돌아옴, 더 있을 수
    있음) X-Next-Cursor 헤더가 실려온다 - 그 값을 다음 호출의 cursor로 그대로
    넘기면 이어서 페이지가 나온다. sort_col(정렬 기준 컬럼)+id를 튜플로 비교하는
    키셋 방식이라(OFFSET이 아님) 페이지가 깊어져도 성능이 떨어지지 않는다."""
    limit = min(limit, 500)
    sort_col = "created_at" if since else "updated_at"
    ascending = bool(since)
    clauses = []
    params: List[Any] = []
    if status:
        params.append(status)
        clauses.append(f"status = ${len(params)}")
    if since:
        # asyncpg는 문자열을 timestamptz 파라미터로 암묵 변환하지 않는다(psycopg2와
        # 달리 "expected a datetime.date or datetime.datetime instance, got 'str'"로
        # 거부) - app.timeparse.parse_iso8601로 datetime으로 직접 변환해서 바인딩해야
        # 한다(2026-07-14, since 폴링이 항상 500이던 원인 - 실측 확인).
        params.append(parse_iso8601(since))
        clauses.append(f"created_at > ${len(params)}")
    if cursor:
        cursor_value, cursor_id = decode_cursor(cursor)
        params.append(parse_iso8601(cursor_value))
        ts_param = len(params)
        params.append(cursor_id)
        id_param = len(params)
        op = ">" if ascending else "<"
        # 튜플(row constructor) 비교 - sort_col이 같은 값이 여러 행에 걸쳐 있어도
        # id(uuid, 항상 유일)를 2차 정렬키로 같이 비교해서 건너뛰거나 중복되지 않는다.
        clauses.append(f"({sort_col}, id) {op} (${ts_param}, ${id_param})")
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    direction = "ASC" if ascending else "DESC"
    order = f"{sort_col} {direction}, id {direction}"
    params.append(limit)

    async with pool().acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT id, title, correlation_key_type, correlation_key_value, severity,
                   status, matched_scenario_rule_id, mitre_tactics, created_at, updated_at
            FROM incidents {where}
            ORDER BY {order} LIMIT ${len(params)}
            """,
            *params,
        )

    if len(rows) == limit:
        last = rows[-1]
        set_next_cursor_header(response, [last[sort_col].isoformat(), str(last["id"])])

    return [_row_to_incident(r) for r in rows]


@router.get("/{incident_id}", response_model=IncidentOut)
async def get_incident(incident_id: str):
    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, title, correlation_key_type, correlation_key_value, severity,
                   status, matched_scenario_rule_id, mitre_tactics, created_at, updated_at
            FROM incidents WHERE id = $1
            """,
            incident_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="incident not found")
    return _row_to_incident(row)


@router.get("/{incident_id}/events", response_model=List[IncidentEventOut])
async def get_incident_events(incident_id: str):
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT event_id, event_module, added_at FROM incident_events
            WHERE incident_id = $1 ORDER BY added_at
            """,
            incident_id,
        )
    return [
        IncidentEventOut(
            event_id=r["event_id"], event_module=r["event_module"], added_at=r["added_at"].isoformat()
        )
        for r in rows
    ]


def _format_detail(source: Dict[str, Any]) -> Optional[str]:
    """OpenSearch 원문(_source, NormalizedEvent를 by_alias=True로 저장한 dot-key dict)에서
    모듈별로 있는 필드만 골라 사람이 읽을 한 줄 요약을 만든다. 대시보드 mock의
    storyline detail(예: "GET /rest/... \\nHTTP 403 · rule=942100")과 같은 역할."""
    module = source.get("event.module")
    parts = []
    if module == "was":
        method = source.get("http.request.method")
        path = source.get("url.path")
        status_code = source.get("http.response.status_code")
        if method or path:
            parts.append(f"{method or ''} {path or ''}".strip())
        if status_code:
            parts.append(f"HTTP {status_code}")
    elif module == "waf":
        if source.get("waf.risk_level"):
            parts.append(f"risk={source['waf.risk_level']}")
        if source.get("waf.payload_snippet"):
            parts.append(source["waf.payload_snippet"])
        if source.get("waf.blocked") is not None:
            parts.append("blocked" if source["waf.blocked"] else "allowed")
    elif module == "falco":
        if source.get("rule.name"):
            parts.append(source["rule.name"])
        if source.get("process.command_line"):
            parts.append(f"cmd={source['process.command_line']}")
        elif source.get("process.name"):
            parts.append(f"proc={source['process.name']}")
    elif module == "k8s_audit":
        if source.get("kubernetes.audit.verb"):
            parts.append(f"verb={source['kubernetes.audit.verb']}")
        if source.get("orchestrator.resource.type"):
            parts.append(f"resource={source['orchestrator.resource.type']}")
        if source.get("user.name"):
            parts.append(f"user={source['user.name']}")

    if source.get("source.ip"):
        parts.append(f"client={source['source.ip']}")

    return " · ".join(parts) if parts else None


@router.get("/{incident_id}/timeline", response_model=List[TimelineEntryOut])
async def get_incident_timeline(incident_id: str):
    """incident_events(Postgres)의 event_id 목록으로 OpenSearch(attack-logs-*)에서
    원문을 한 번에 조회해 시간순 스토리라인으로 합친다. mitre_technique_id는 이
    인시던트가 물고 있는 scenario_rules.mitre_technique_id를 전체 스텝에 동일하게
    붙인다 - 이벤트 단위 MITRE 태깅은 없고, 인시던트 전체가 매핑된 단일 기법이라서다.
    OpenSearch에 원문이 없으면(리텐션 만료 등) title/detail 없이 graceful degrade."""
    async with pool().acquire() as conn:
        incident = await conn.fetchrow(
            "SELECT matched_scenario_rule_id FROM incidents WHERE id = $1", incident_id
        )
        if not incident:
            raise HTTPException(status_code=404, detail="incident not found")

        mitre_technique_id: Optional[str] = None
        if incident["matched_scenario_rule_id"]:
            scenario = await conn.fetchrow(
                "SELECT mitre_technique_id FROM scenario_rules WHERE id = $1",
                incident["matched_scenario_rule_id"],
            )
            mitre_technique_id = scenario["mitre_technique_id"] if scenario else None

        events = await conn.fetch(
            """
            SELECT event_id, event_module, added_at FROM incident_events
            WHERE incident_id = $1 ORDER BY added_at
            """,
            incident_id,
        )

    event_ids = [e["event_id"] for e in events]
    sources_by_id: Dict[str, Dict[str, Any]] = {}
    if event_ids:
        result = await opensearch_client.search(
            index=settings.attack_log_index_pattern,
            body={"query": {"terms": {"event.id": event_ids}}, "size": len(event_ids)},
        )
        sources_by_id = {hit["_source"]["event.id"]: hit["_source"] for hit in result["hits"]["hits"]}

    entries = []
    for e in events:
        source = sources_by_id.get(e["event_id"])
        entries.append(
            TimelineEntryOut(
                event_id=e["event_id"],
                event_module=e["event_module"],
                added_at=e["added_at"].isoformat(),
                title=(source.get("event.action") if source else None) or "(원본 로그 없음)",
                detail=_format_detail(source) if source else None,
                mitre_technique_id=mitre_technique_id,
            )
        )
    return entries


@router.patch("/{incident_id}/status", response_model=IncidentOut)
async def update_status(incident_id: str, body: StatusUpdate, request: Request):
    async with pool().acquire() as conn:
        current = await conn.fetchrow("SELECT status FROM incidents WHERE id = $1", incident_id)
        if not current:
            raise HTTPException(status_code=404, detail="incident not found")

        if body.status not in _VALID_TRANSITIONS.get(current["status"], set()):
            raise HTTPException(
                status_code=400,
                detail=f"invalid transition {current['status']} -> {body.status}",
            )

        row = await conn.fetchrow(
            """
            UPDATE incidents SET status = $2, updated_at = now() WHERE id = $1
            RETURNING id, title, correlation_key_type, correlation_key_value, severity,
                      status, matched_scenario_rule_id, mitre_tactics, created_at, updated_at
            """,
            incident_id,
            body.status,
        )
    await record_action(
        "INCIDENT_STATUS_CHANGED",
        "incidents",
        _client_ip(request),
        user_id=current_user_id(request),
        record_id=incident_id,
    )
    return _row_to_incident(row)
