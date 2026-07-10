"""관리자 행위 감사 로그 기록 (AuditLog API가 조회하는 audit_logs 테이블에 쓴다).

user_id는 지금 단일 관리자 계정 스텁이라 실제 users 테이블 행과 연결돼 있지 않음 -
NULL로 남긴다 (P5-2 인증 모델이 실제로 이관되면 그때 채울 것)."""
from typing import Optional

from app.db import pool


async def record_action(action: str, target_table: Optional[str], ip_address: Optional[str]) -> None:
    async with pool().acquire() as conn:
        await conn.execute(
            """
            INSERT INTO audit_logs (user_id, action, target_table, ip_address)
            VALUES (NULL, $1, $2, $3)
            """,
            action,
            target_table,
            ip_address,
        )
