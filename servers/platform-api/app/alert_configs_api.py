"""AlertConfig API (/alert-configs) - Slack/Discord 알림 설정 CRUD.
app/notifications.py가 이 테이블을 조회해서 실제 발송 여부/대상(channel_type,
webhook_url, enabled, min_severity)을 결정한다."""
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.audit import record_action
from app.auth import current_user_id
from app.db import pool

router = APIRouter(prefix="/alert-configs", tags=["alert-configs"])


def _client_ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


class AlertConfigIn(BaseModel):
    channel_type: str  # "slack" | "discord"
    webhook_url: str
    enabled: bool = True
    min_severity: int = 4


class AlertConfigOut(AlertConfigIn):
    id: str


def _row_to_out(row) -> AlertConfigOut:
    return AlertConfigOut(
        id=str(row["id"]),
        channel_type=row["channel_type"],
        webhook_url=row["webhook_url"],
        enabled=row["enabled"],
        min_severity=row["min_severity"],
    )


@router.get("", response_model=List[AlertConfigOut])
async def list_alert_configs():
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, channel_type, webhook_url, enabled, min_severity FROM alert_configs ORDER BY created_at"
        )
    return [_row_to_out(r) for r in rows]


@router.post("", response_model=AlertConfigOut)
async def create_alert_config(body: AlertConfigIn, request: Request):
    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO alert_configs (channel_type, webhook_url, enabled, min_severity)
            VALUES ($1, $2, $3, $4)
            RETURNING id, channel_type, webhook_url, enabled, min_severity
            """,
            body.channel_type,
            body.webhook_url,
            body.enabled,
            body.min_severity,
        )
    await record_action(
        "ALERT_CONFIG_CREATED",
        "alert_configs",
        _client_ip(request),
        user_id=current_user_id(request),
        record_id=row["id"],
    )
    return _row_to_out(row)


@router.patch("/{config_id}", response_model=AlertConfigOut)
async def update_alert_config(config_id: str, body: AlertConfigIn, request: Request):
    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE alert_configs
            SET channel_type = $2, webhook_url = $3, enabled = $4, min_severity = $5, updated_at = now()
            WHERE id = $1
            RETURNING id, channel_type, webhook_url, enabled, min_severity
            """,
            config_id,
            body.channel_type,
            body.webhook_url,
            body.enabled,
            body.min_severity,
        )
    if not row:
        raise HTTPException(status_code=404, detail="alert config not found")
    await record_action(
        "ALERT_CONFIG_UPDATED",
        "alert_configs",
        _client_ip(request),
        user_id=current_user_id(request),
        record_id=config_id,
    )
    return _row_to_out(row)


@router.delete("/{config_id}")
async def delete_alert_config(config_id: str, request: Request):
    async with pool().acquire() as conn:
        result = await conn.execute("DELETE FROM alert_configs WHERE id = $1", config_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="alert config not found")
    await record_action(
        "ALERT_CONFIG_DELETED",
        "alert_configs",
        _client_ip(request),
        user_id=current_user_id(request),
        record_id=config_id,
    )
    return {"status": "ok"}
