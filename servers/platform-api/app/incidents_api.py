"""인시던트 API (P5-1). 목록/상세/상태 변경(open→investigating→closed) +
incident_events 서브 리소스. datastore/postgres/init/001-schema.sql의
incidents/incident_events/scenario_rules 참고."""
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.db import pool

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
async def list_incidents(status: Optional[str] = None, limit: int = 50):
    limit = min(limit, 500)
    async with pool().acquire() as conn:
        if status:
            rows = await conn.fetch(
                """
                SELECT id, title, correlation_key_type, correlation_key_value, severity,
                       status, matched_scenario_rule_id, mitre_tactics, created_at, updated_at
                FROM incidents WHERE status = $1
                ORDER BY updated_at DESC LIMIT $2
                """,
                status,
                limit,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT id, title, correlation_key_type, correlation_key_value, severity,
                       status, matched_scenario_rule_id, mitre_tactics, created_at, updated_at
                FROM incidents ORDER BY updated_at DESC LIMIT $1
                """,
                limit,
            )
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


@router.patch("/{incident_id}/status", response_model=IncidentOut)
async def update_status(incident_id: str, body: StatusUpdate):
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
    return _row_to_incident(row)
