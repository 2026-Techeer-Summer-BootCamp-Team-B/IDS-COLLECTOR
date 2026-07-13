"""Allow-list API (/allow-list) - 탐지 예외 IP/대역 등록. target_id를 주면 해당
target에만 적용, 생략하면 전역 예외(001-schema.sql 참고).

주의: 여기 등록한 예외를 실제로 걸러내는 코드(correlation-engine/normalizer)는 아직
없다 - 이번 작업은 등록/관리 API까지고, "이 IP는 탐지 제외"를 파이프라인에 실제로
반영하는 건 별도 범위다."""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.audit import record_action
from app.auth import current_user_id
from app.db import pool

router = APIRouter(prefix="/allow-list", tags=["allow-list"])


def _client_ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class AllowListIn(BaseModel):
    ip_or_cidr: str
    target_id: Optional[str] = None
    reason: Optional[str] = None
    expires_at: Optional[str] = None  # ISO8601, 생략하면 무기한


class AllowListOut(BaseModel):
    id: str
    ip_or_cidr: str
    target_id: Optional[str]
    reason: Optional[str]
    expires_at: Optional[str]


def _row_to_out(row) -> AllowListOut:
    return AllowListOut(
        id=str(row["id"]),
        ip_or_cidr=row["ip_or_cidr"],
        target_id=str(row["target_id"]) if row["target_id"] else None,
        reason=row["reason"],
        expires_at=row["expires_at"].isoformat() if row["expires_at"] else None,
    )


@router.get("", response_model=List[AllowListOut])
async def list_allow_list(target_id: Optional[str] = None):
    async with pool().acquire() as conn:
        if target_id:
            rows = await conn.fetch(
                """
                SELECT id, ip_or_cidr, target_id, reason, expires_at
                FROM allow_list WHERE target_id = $1 ORDER BY id
                """,
                target_id,
            )
        else:
            rows = await conn.fetch(
                "SELECT id, ip_or_cidr, target_id, reason, expires_at FROM allow_list ORDER BY id"
            )
    return [_row_to_out(r) for r in rows]


@router.post("", response_model=AllowListOut)
async def create_allow_list_entry(body: AllowListIn, request: Request):
    async with pool().acquire() as conn:
        if body.target_id is not None:
            exists = await conn.fetchval("SELECT count(*) FROM targets WHERE id = $1", body.target_id)
            if not exists:
                raise HTTPException(status_code=404, detail="target not found")

        row = await conn.fetchrow(
            """
            INSERT INTO allow_list (ip_or_cidr, target_id, reason, expires_at)
            VALUES ($1, $2, $3, $4)
            RETURNING id, ip_or_cidr, target_id, reason, expires_at
            """,
            body.ip_or_cidr,
            body.target_id,
            body.reason,
            _parse_iso(body.expires_at),
        )
    await record_action(
        "ALLOW_LIST_CREATED", "allow_list", _client_ip(request), user_id=current_user_id(request)
    )
    return _row_to_out(row)


@router.delete("/{entry_id}")
async def delete_allow_list_entry(entry_id: str, request: Request):
    async with pool().acquire() as conn:
        result = await conn.execute("DELETE FROM allow_list WHERE id = $1", entry_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="allow-list entry not found")
    await record_action(
        "ALLOW_LIST_DELETED", "allow_list", _client_ip(request), user_id=current_user_id(request)
    )
    return {"status": "ok"}
