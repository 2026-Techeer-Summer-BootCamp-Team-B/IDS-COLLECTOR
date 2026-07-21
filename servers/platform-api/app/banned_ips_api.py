"""IP 차단 기록 API (/banned-ips) - datastore/postgres/init/004-banned-ips.sql 참고.
이 프로젝트엔 실제 방화벽/iptables/WAF 제어 API가 없어서 여기 기록해도 트래픽이
진짜로 막히진 않는다 - 대시보드의 "차단" 버튼이 뭔가에 반응하도록 기록/감사
트레일만 남기는 용도다(audit_logs의 IP_BANNED/IP_UNBANNED)."""
import ipaddress
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.audit import record_action
from app.auth import current_user_id
from app.db import pool

router = APIRouter(prefix="/banned-ips", tags=["banned-ips"])


def _validate_ip_or_cidr(value: str) -> None:
    """allow_list_api.py의 동일 검증과 같은 이유 - 형식 검증 없이 저장하면
    "not-an-ip"/"999.1.1.1" 같은 값도 그대로 저장돼 대시보드에 "차단됨"으로
    표시된다. 이 API 자체는 실제 트래픽을 막지 않는 기록/감사 전용이지만, 기록되는
    값이 애초에 유효한 IP/CIDR이어야 그 기록이 의미가 있다."""
    try:
        ipaddress.ip_network(value, strict=False)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"invalid ip_or_cidr {value!r}: {e}")


class BanIn(BaseModel):
    ip_or_cidr: str
    reason: Optional[str] = None


class BannedIpOut(BaseModel):
    id: str
    ip_or_cidr: str
    reason: Optional[str]
    hit_count: int
    created_at: str
    unbanned_at: Optional[str]


def _client_ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _row_to_out(row) -> BannedIpOut:
    return BannedIpOut(
        id=str(row["id"]),
        # allow_list_api.py와 동일한 이유 - 019-db-hardening.sql부터 inet 컬럼이라
        # asyncpg가 ipaddress 객체로 돌려준다.
        ip_or_cidr=str(row["ip_or_cidr"]),
        reason=row["reason"],
        hit_count=row["hit_count"],
        created_at=row["created_at"].isoformat(),
        unbanned_at=row["unbanned_at"].isoformat() if row["unbanned_at"] else None,
    )


@router.get("", response_model=List[BannedIpOut])
async def list_banned_ips():
    """현재 활성 차단만(unbanned_at IS NULL) - 해제 이력까지 보려면 audit-logs 참고."""
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, ip_or_cidr, reason, hit_count, created_at, unbanned_at
            FROM banned_ips WHERE unbanned_at IS NULL ORDER BY created_at DESC
            """
        )
    return [_row_to_out(r) for r in rows]


@router.post("", response_model=BannedIpOut)
async def ban_ip(body: BanIn, request: Request):
    _validate_ip_or_cidr(body.ip_or_cidr)
    async with pool().acquire() as conn:
        # 같은 IP를 예전에도 차단한 적이 있으면(해제 후 재차단 포함) 그 이력의 최대
        # hit_count에 이어서 누적한다 - "이 IP가 총 몇 번째 차단인지"를 나타낸다.
        prior_hits = await conn.fetchval(
            "SELECT COALESCE(MAX(hit_count), 0) FROM banned_ips WHERE ip_or_cidr = $1",
            body.ip_or_cidr,
        )
        row = await conn.fetchrow(
            """
            INSERT INTO banned_ips (ip_or_cidr, reason, hit_count)
            VALUES ($1, $2, $3)
            RETURNING id, ip_or_cidr, reason, hit_count, created_at, unbanned_at
            """,
            body.ip_or_cidr,
            body.reason,
            prior_hits + 1,
        )
    await record_action(
        "IP_BANNED",
        "banned_ips",
        _client_ip(request),
        user_id=current_user_id(request),
        record_id=row["id"],
    )
    return _row_to_out(row)


@router.delete("/{banned_ip_id}", response_model=BannedIpOut)
async def unban_ip(banned_ip_id: UUID, request: Request):
    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE banned_ips SET unbanned_at = now()
            WHERE id = $1 AND unbanned_at IS NULL
            RETURNING id, ip_or_cidr, reason, hit_count, created_at, unbanned_at
            """,
            banned_ip_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="banned ip not found (or already unbanned)")
    await record_action(
        "IP_UNBANNED",
        "banned_ips",
        _client_ip(request),
        user_id=current_user_id(request),
        record_id=banned_ip_id,
    )
    return _row_to_out(row)
