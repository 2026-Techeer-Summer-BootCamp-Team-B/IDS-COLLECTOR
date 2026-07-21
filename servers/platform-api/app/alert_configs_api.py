"""AlertConfig API (/alert-configs) - Slack/Discord 알림 설정 CRUD.
app/notifications.py가 이 테이블을 조회해서 실제 발송 여부/대상(channel_type,
webhook_url, enabled, min_severity)을 결정한다.

경로 파라미터를 str이 아니라 UUID로 선언한다(2026-07-21, 이 패턴은
alert_configs_api/allow_list_api/banned_ips_api/incidents_api/scenarios_api/
targets_api/users_api 전체에 동일하게 적용) - 이 id들은 전부 uuid 컬럼(001-schema.sql
등)이라 형식이 안 맞는 값(예: GET /alert-configs/not-a-uuid)이 오면 asyncpg가
파라미터 바인딩 시점에 캐스트 에러로 죽어서 이 요청이 핸들러 코드에 닿지도 못하고
그대로 처리되지 않은 500으로 샜다. FastAPI가 UUID 타입 힌트를 보고 라우트 진입
전에 형식을 검증해서, 형식이 틀리면 422(핸들러 실행 전 요청 검증 실패)로 깔끔하게
막고, 형식이 맞으면 이후 로직(DB 조회 후 404 등)은 그대로 동작한다."""
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

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
    _validate_channel_type(body.channel_type)
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
async def update_alert_config(config_id: UUID, body: AlertConfigIn, request: Request):
    _validate_channel_type(body.channel_type)
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
async def delete_alert_config(config_id: UUID, request: Request):
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
