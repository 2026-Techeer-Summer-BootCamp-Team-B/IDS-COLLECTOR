"""IP 차단 기록 API (/banned-ips) - datastore/postgres/init/004-banned-ips.sql 참고.
이 프로젝트엔 실제 방화벽/iptables/WAF 제어 API가 없어서 여기 기록해도 트래픽이
진짜로 막히진 않는다 - 대시보드의 "차단" 버튼이 뭔가에 반응하도록 기록/감사
트레일만 남기는 용도다(audit_logs의 IP_BANNED/IP_UNBANNED)."""
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.audit import record_action
from app.db import pool

router = APIRouter(prefix="/banned-ips", tags=["banned-ips"])


class BanIn(BaseModel):
    ip_or_cidr: str
    reason: Optional[str] = None


class BannedIpOut(BaseModel):
    id: str
    ip_or_cidr: str
    reason: Optional[str]
    created_at: str
    unbanned_at: Optional[str]


def _client_ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _row_to_out(row) -> BannedIpOut:
    return BannedIpOut(
        id=str(row["id"]),
        ip_or_cidr=row["ip_or_cidr"],
        reason=row["reason"],
        created_at=row["created_at"].isoformat(),
        unbanned_at=row["unbanned_at"].isoformat() if row["unbanned_at"] else None,
    )


@router.get("", response_model=List[BannedIpOut])
async def list_banned_ips():
    """현재 활성 차단만(unbanned_at IS NULL) - 해제 이력까지 보려면 audit-logs 참고."""
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, ip_or_cidr, reason, created_at, unbanned_at
            FROM banned_ips WHERE unbanned_at IS NULL ORDER BY created_at DESC
            """
        )
    return [_row_to_out(r) for r in rows]


@router.post("", response_model=BannedIpOut)
async def ban_ip(body: BanIn, request: Request):
    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO banned_ips (ip_or_cidr, reason)
            VALUES ($1, $2)
            RETURNING id, ip_or_cidr, reason, created_at, unbanned_at
            """,
            body.ip_or_cidr,
            body.reason,
        )
    await record_action("IP_BANNED", "banned_ips", _client_ip(request))
    return _row_to_out(row)


@router.delete("/{banned_ip_id}", response_model=BannedIpOut)
async def unban_ip(banned_ip_id: str, request: Request):
    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE banned_ips SET unbanned_at = now()
            WHERE id = $1 AND unbanned_at IS NULL
            RETURNING id, ip_or_cidr, reason, created_at, unbanned_at
            """,
            banned_ip_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="banned ip not found (or already unbanned)")
    await record_action("IP_UNBANNED", "banned_ips", _client_ip(request))
    return _row_to_out(row)
