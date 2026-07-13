"""관리자 행위 감사 로그 기록 (AuditLog API가 조회하는 audit_logs 테이블에 쓴다).

user_id는 app/auth.py가 로그인 시 실제 users 테이블 행을 조회해서 넘겨준다 - 인증을
거치지 않는 호출부(다른 API들의 record_action 호출)는 아직 current-user 컨텍스트가
없어 기본값 NULL로 남는다."""
from typing import Optional
from uuid import UUID

from app.db import pool


async def record_action(
    action: str,
    target_table: Optional[str],
    ip_address: Optional[str],
    user_id: Optional[UUID] = None,
) -> None:
    async with pool().acquire() as conn:
        await conn.execute(
            """
            INSERT INTO audit_logs (user_id, action, target_table, ip_address)
            VALUES ($1, $2, $3, $4)
            """,
            user_id,
            action,
            target_table,
            ip_address,
        )
