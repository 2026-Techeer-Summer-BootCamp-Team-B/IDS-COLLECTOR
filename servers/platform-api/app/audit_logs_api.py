"""AuditLog API (/audit-logs) - 관리자 행위 감사 로그 조회 (스켈레톤)."""
from typing import List, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.db import pool

router = APIRouter(prefix="/audit-logs", tags=["audit-logs"])


class AuditLogOut(BaseModel):
    id: str
    user_id: Optional[str]
    action: str
    target_table: Optional[str]
    record_id: Optional[str]
    ip_address: Optional[str]
    user_agent: Optional[str]
    created_at: str


@router.get("", response_model=List[AuditLogOut])
async def list_audit_logs(limit: int = 50):
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, user_id, action, target_table, record_id, ip_address, user_agent, created_at
            FROM audit_logs ORDER BY created_at DESC LIMIT $1
            """,
            min(limit, 500),
        )
    return [
        AuditLogOut(
            id=str(r["id"]),
            user_id=str(r["user_id"]) if r["user_id"] else None,
            action=r["action"],
            target_table=r["target_table"],
            record_id=str(r["record_id"]) if r["record_id"] else None,
            ip_address=r["ip_address"],
            user_agent=r["user_agent"],
            created_at=r["created_at"].isoformat(),
        )
        for r in rows
    ]
