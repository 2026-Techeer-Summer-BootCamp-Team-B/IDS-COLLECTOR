"""AlertConfig API (/alert-configs) - Slack/Discord 알림 설정 CRUD.
app/notifications.py가 이 테이블을 조회해서 실제 발송 여부/대상(channel_type,
webhook_url, enabled, min_severity)을 결정한다."""
import json
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, field_validator

from app.audit import record_action
from app.auth import current_user_id
from app.db import pool
from app.notifications import SUPPORTED_CHANNEL_TYPES

router = APIRouter(prefix="/alert-configs", tags=["alert-configs"])


def _client_ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _validate_channel_type(channel_type: str) -> None:
    """오타난 channel_type("slcak" 등)은 예전엔 저장은 그대로 되고 발송 시점에
    app/notifications.py가 조용히 무시했다 - 등록/토글 시점에 막아서 그 채널이
    조용히 죽어있는 상태로 남는 걸 방지한다."""
    if channel_type not in SUPPORTED_CHANNEL_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"invalid channel_type {channel_type!r} (허용: {sorted(SUPPORTED_CHANNEL_TYPES)})",
        )


class AlertConfigIn(BaseModel):
    channel_type: str  # "slack" | "discord"
    webhook_url: str
    enabled: bool = True
    min_severity: int = 4
    receive_incidents: bool = True
    receive_trend_report: bool = False
    trend_report_time: Optional[str] = None
    trend_report_schedule: List[dict] = []

    @field_validator("trend_report_time")
    @classmethod
    def validate_trend_report_time(cls, value: Optional[str]) -> Optional[str]:
        if value is None or value == "":
            return None
        if len(value) != 5 or value[2] != ":" or not (value[:2] + value[3:]).isdigit() or not (0 <= int(value[:2]) <= 23 and 0 <= int(value[3:]) <= 59):
            raise ValueError("trend_report_time must be HH:MM")
        return value


class AlertConfigOut(AlertConfigIn):
    id: str


def _row_to_out(row) -> AlertConfigOut:
    return AlertConfigOut(
        id=str(row["id"]),
        channel_type=row["channel_type"],
        webhook_url=row["webhook_url"],
        enabled=row["enabled"],
        min_severity=row["min_severity"],
        receive_incidents=row["receive_incidents"],
        receive_trend_report=row["receive_trend_report"],
        trend_report_time=row["trend_report_time"],
        trend_report_schedule=json.loads(row["trend_report_schedule"]) if isinstance(row["trend_report_schedule"], str) else row["trend_report_schedule"],
    )


@router.get("", response_model=List[AlertConfigOut])
async def list_alert_configs():
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, channel_type, webhook_url, enabled, min_severity, receive_incidents, receive_trend_report, trend_report_time, trend_report_schedule FROM alert_configs ORDER BY created_at"
        )
    return [_row_to_out(r) for r in rows]


@router.post("", response_model=AlertConfigOut)
async def create_alert_config(body: AlertConfigIn, request: Request):
    _validate_channel_type(body.channel_type)
    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO alert_configs (channel_type, webhook_url, enabled, min_severity, receive_incidents, receive_trend_report, trend_report_time, trend_report_schedule)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
            RETURNING id, channel_type, webhook_url, enabled, min_severity, receive_incidents, receive_trend_report, trend_report_time, trend_report_schedule
            """,
            body.channel_type,
            body.webhook_url,
            body.enabled,
            body.min_severity,
            body.receive_incidents,
            body.receive_trend_report,
            body.trend_report_time,
            __import__("json").dumps(body.trend_report_schedule),
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
    _validate_channel_type(body.channel_type)
    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE alert_configs
            SET channel_type = $2, webhook_url = $3, enabled = $4, min_severity = $5,
                receive_incidents = $6, receive_trend_report = $7, trend_report_time = $8, trend_report_schedule = $9::jsonb, updated_at = now()
            WHERE id = $1
            RETURNING id, channel_type, webhook_url, enabled, min_severity, receive_incidents, receive_trend_report, trend_report_time, trend_report_schedule
            """,
            config_id,
            body.channel_type,
            body.webhook_url,
            body.enabled,
            body.min_severity,
            body.receive_incidents,
            body.receive_trend_report,
            body.trend_report_time,
            __import__("json").dumps(body.trend_report_schedule),
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
