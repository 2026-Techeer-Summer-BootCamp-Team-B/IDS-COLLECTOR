"""리포트 알림 연동 API (/report-notifications) - 사용자별 Slack/Discord OAuth 연동
CRUD + 최근 발송 이력 조회.

OAuth 앱 등록이 아직 안 끝나서 실제 토큰 교환은 없다 - 프론트(dashboard/src/lib/
reportIntegrationsMock.js)가 목업 함수로 즉시 "연결됨" 상태의 access_token/
workspace_or_server_name/channel_id를 만들어 POST로 넘기면, 여기서는 그 값을
그대로(단, access_token은 app/crypto_utils.py로 암호화해서) 저장한다 - 나중에 실제
OAuth 콜백으로 교체돼도 이 저장 계약(POST body 필드)은 안 바뀐다.

app/alert_configs_api.py(webhook URL 고정 등록, 인시던트 실시간 알림용)와는 별개 -
이쪽은 스케줄 AI 트렌드 리포트(app/report_notification_service.py가 소비) 전용이고
사용자 계정별로 연동이 분리된다."""
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.audit import record_action
from app.auth import current_user_id
from app.crypto_utils import encrypt_token
from app.db import pool

router = APIRouter(prefix="/report-notifications", tags=["report-notifications"])

_SUPPORTED_PLATFORMS = frozenset({"slack", "discord"})


def _client_ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _require_user_id(request: Request) -> UUID:
    """이 API는 user_id가 NOT NULL FK라 익명 호출을 받을 수 없다 - 게이트웨이 시크릿
    검사(app/main.py)를 통과했더라도 Traefik forwardAuth를 거치지 않은 직결 호출이면
    X-Auth-User-Id가 없을 수 있으므로 여기서 한 번 더 막는다."""
    user_id = current_user_id(request)
    if user_id is None:
        raise HTTPException(status_code=401, detail="로그인 세션이 필요합니다")
    return user_id


def _validate_platform(platform: str) -> None:
    if platform not in _SUPPORTED_PLATFORMS:
        raise HTTPException(
            status_code=400,
            detail=f"invalid platform {platform!r} (허용: {sorted(_SUPPORTED_PLATFORMS)})",
        )


class ReportIntegrationConnectIn(BaseModel):
    platform: str  # "slack" | "discord"
    access_token: str
    workspace_or_server_name: str
    channel_id: str


class ReportIntegrationUpdateIn(BaseModel):
    enabled: bool


class ReportIntegrationOut(BaseModel):
    id: str
    platform: str
    workspace_or_server_name: str
    channel_id: str
    enabled: bool
    created_at: str
    updated_at: str


def _row_to_out(row) -> ReportIntegrationOut:
    return ReportIntegrationOut(
        id=str(row["id"]),
        platform=row["platform"],
        workspace_or_server_name=row["workspace_or_server_name"],
        channel_id=row["channel_id"],
        enabled=row["enabled"],
        created_at=row["created_at"].isoformat(),
        updated_at=row["updated_at"].isoformat(),
    )


_CONNECTION_FIELDS = (
    "id, platform, workspace_or_server_name, channel_id, enabled, created_at, updated_at"
)


@router.get("/connections", response_model=List[ReportIntegrationOut])
async def list_connections(request: Request):
    user_id = _require_user_id(request)
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            f"SELECT {_CONNECTION_FIELDS} FROM report_notification_connections "
            "WHERE user_id = $1 ORDER BY created_at",
            user_id,
        )
    return [_row_to_out(r) for r in rows]


@router.post("/connections", response_model=ReportIntegrationOut)
async def connect(body: ReportIntegrationConnectIn, request: Request):
    """목업 connectSlack()/connectDiscord()가 돌려준 값을 저장 - 이미 같은 사용자가
    같은 platform으로 연동돼 있으면(024 마이그레이션의 UNIQUE(user_id, platform))
    재연결로 취급해 덮어쓴다("연결하기"를 다시 눌러도 새 행이 안 쌓이게)."""
    _validate_platform(body.platform)
    user_id = _require_user_id(request)
    encrypted = encrypt_token(body.access_token)

    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            f"""
            INSERT INTO report_notification_connections
                (user_id, platform, access_token_encrypted, workspace_or_server_name, channel_id, enabled)
            VALUES ($1, $2, $3, $4, $5, true)
            ON CONFLICT (user_id, platform) DO UPDATE
            SET access_token_encrypted = EXCLUDED.access_token_encrypted,
                workspace_or_server_name = EXCLUDED.workspace_or_server_name,
                channel_id = EXCLUDED.channel_id,
                enabled = true,
                updated_at = now()
            RETURNING {_CONNECTION_FIELDS}
            """,
            user_id,
            body.platform,
            encrypted,
            body.workspace_or_server_name,
            body.channel_id,
        )

    await record_action(
        "REPORT_INTEGRATION_CONNECTED",
        "report_notification_connections",
        _client_ip(request),
        user_id=user_id,
        record_id=row["id"],
    )
    return _row_to_out(row)


@router.patch("/connections/{connection_id}", response_model=ReportIntegrationOut)
async def update_connection(connection_id: str, body: ReportIntegrationUpdateIn, request: Request):
    user_id = _require_user_id(request)
    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            f"""
            UPDATE report_notification_connections
            SET enabled = $3, updated_at = now()
            WHERE id = $1 AND user_id = $2
            RETURNING {_CONNECTION_FIELDS}
            """,
            connection_id,
            user_id,
            body.enabled,
        )
    if not row:
        raise HTTPException(status_code=404, detail="연동을 찾을 수 없습니다")

    await record_action(
        "REPORT_INTEGRATION_UPDATED",
        "report_notification_connections",
        _client_ip(request),
        user_id=user_id,
        record_id=connection_id,
    )
    return _row_to_out(row)


@router.delete("/connections/{connection_id}")
async def disconnect(connection_id: str, request: Request):
    user_id = _require_user_id(request)
    async with pool().acquire() as conn:
        result = await conn.execute(
            "DELETE FROM report_notification_connections WHERE id = $1 AND user_id = $2",
            connection_id,
            user_id,
        )
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="연동을 찾을 수 없습니다")

    await record_action(
        "REPORT_INTEGRATION_DISCONNECTED",
        "report_notification_connections",
        _client_ip(request),
        user_id=user_id,
        record_id=connection_id,
    )
    return {"status": "ok"}


class ReportNotificationHistoryOut(BaseModel):
    id: str
    platform: str
    channel_id: str
    status: str
    mocked: bool
    error_message: Optional[str]
    sent_at: str


@router.get("/history", response_model=List[ReportNotificationHistoryOut])
async def list_history(limit: int = 20):
    """팀 전체 발송 이력 - audit_logs와 동일하게 사용자 스코프 없이 전부 보여준다
    (연동은 계정별이지만 "스케줄 리포트가 실제로 나갔는지"는 운영 관점의 공용 정보)."""
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, platform, channel_id, status, mocked, error_message, sent_at
            FROM report_notification_history
            ORDER BY sent_at DESC
            LIMIT $1
            """,
            limit,
        )
    return [
        ReportNotificationHistoryOut(
            id=str(r["id"]),
            platform=r["platform"],
            channel_id=r["channel_id"],
            status=r["status"],
            mocked=r["mocked"],
            error_message=r["error_message"],
            sent_at=r["sent_at"].isoformat(),
        )
        for r in rows
    ]
