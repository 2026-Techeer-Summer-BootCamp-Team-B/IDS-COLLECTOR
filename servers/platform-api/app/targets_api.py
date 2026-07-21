"""Target API (/targets) - 보호 대상 애플리케이션 등록/관리. targets 테이블
(001-schema.sql)은 있었지만 API가 없어서 완전 미사용이었다. allow_list.target_id가
이 테이블을 FK로 참조하므로 allow_list보다 먼저 있어야 한다.

주의: 여기 등록한 target을 실제로 소비하는 파이프라인 코드는 아직 없다 -
normalizer/app/enrichment.py의 _TARGET_NAMESPACE/_TARGET_POD_NAME 하드코딩(단일 타깃
전제)을 이 테이블 조회로 바꾸는 건 별도 범위다(normalizer가 지금 Postgres 연결 자체가
없어서 그 자체로 별도 작업)."""
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.audit import record_action
from app.auth import current_user_id
from app.db import pool

router = APIRouter(prefix="/targets", tags=["targets"])


def _client_ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


class TargetIn(BaseModel):
    name: str
    base_url: str
    is_active: bool = True


class TargetOut(TargetIn):
    id: str
    created_at: str
    updated_at: str


def _row_to_out(row) -> TargetOut:
    return TargetOut(
        id=str(row["id"]),
        name=row["name"],
        base_url=row["base_url"],
        is_active=row["is_active"],
        created_at=row["created_at"].isoformat(),
        updated_at=row["updated_at"].isoformat(),
    )


@router.get("", response_model=List[TargetOut])
async def list_targets():
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, name, base_url, is_active, created_at, updated_at FROM targets ORDER BY created_at"
        )
    return [_row_to_out(r) for r in rows]


@router.post("", response_model=TargetOut)
async def create_target(body: TargetIn, request: Request):
    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO targets (name, base_url, is_active)
            VALUES ($1, $2, $3)
            RETURNING id, name, base_url, is_active, created_at, updated_at
            """,
            body.name,
            body.base_url,
            body.is_active,
        )
    await record_action(
        "TARGET_CREATED", "targets", _client_ip(request), user_id=current_user_id(request), record_id=row["id"]
    )
    return _row_to_out(row)


@router.patch("/{target_id}", response_model=TargetOut)
async def update_target(target_id: UUID, body: TargetIn, request: Request):
    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE targets SET name = $2, base_url = $3, is_active = $4, updated_at = now() WHERE id = $1
            RETURNING id, name, base_url, is_active, created_at, updated_at
            """,
            target_id,
            body.name,
            body.base_url,
            body.is_active,
        )
    if not row:
        raise HTTPException(status_code=404, detail="target not found")
    await record_action(
        "TARGET_UPDATED", "targets", _client_ip(request), user_id=current_user_id(request), record_id=target_id
    )
    return _row_to_out(row)


@router.delete("/{target_id}")
async def delete_target(target_id: UUID, request: Request):
    async with pool().acquire() as conn:
        referenced = await conn.fetchval(
            "SELECT count(*) FROM allow_list WHERE target_id = $1", target_id
        )
        if referenced:
            raise HTTPException(
                status_code=409, detail="target이 allow_list 항목에서 참조 중이라 삭제할 수 없음"
            )
        result = await conn.execute("DELETE FROM targets WHERE id = $1", target_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="target not found")
    await record_action(
        "TARGET_DELETED", "targets", _client_ip(request), user_id=current_user_id(request), record_id=target_id
    )
    return {"status": "ok"}
