"""AuditLog API (/audit-logs) - 관리자 행위 감사 로그 조회 (스켈레톤)."""
from typing import List, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.db import pool

router = APIRouter(prefix="/audit-logs", tags=["audit-logs"])


class AuditLogOut(BaseModel):
    id: str
    user_id: Optional[str]
    # users_api.py 추가(2026-07-14) 이후 LEFT JOIN으로 채워짐 - 계정이 나중에
    # 삭제됐으면(users_api.py delete_user) user_id는 남아있어도 username은 null이 된다.
    username: Optional[str]
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
            SELECT a.id, a.user_id, u.username, a.action, a.target_table, a.record_id,
                   a.ip_address, a.user_agent, a.created_at
            FROM audit_logs a
            LEFT JOIN users u ON u.id = a.user_id
            ORDER BY a.created_at DESC LIMIT $1
            """,
            min(limit, 500),
        )
    return [
        AuditLogOut(
            id=str(r["id"]),
            user_id=str(r["user_id"]) if r["user_id"] else None,
            username=r["username"],
            action=r["action"],
            target_table=r["target_table"],
            record_id=str(r["record_id"]) if r["record_id"] else None,
            ip_address=r["ip_address"],
            user_agent=r["user_agent"],
            created_at=r["created_at"].isoformat(),
        )
        for r in rows
    ]
