"""관리자 행위 감사 로그 기록 (AuditLog API가 조회하는 audit_logs 테이블에 쓴다).

user_id는 app/auth.py의 current_user_id(request)(Traefik이 실어준 X-Auth-User-Id)로
채운다. record_id는 target_table 안에서 실제로 바뀐 행의 PK - target_table만으로는
"어떤 테이블을 건드렸는지"만 알 수 있고 "그 테이블의 어느 행인지"는 알 수 없어서
(예: allow_list 항목 100개 중 몇 번째를 지웠는지) 추가했다. 여러 테이블을 가리킬 수
있어 FK는 안 걸고(폴리모픽 참조라 단일 REFERENCES 불가) 그냥 UUID로만 저장한다.

user_agent는 "관리자 접속 기록"(누가 언제 어떤 기기/브라우저로 로그인했는지) 용도 -
app/auth.py의 LOGIN/LOGOUT에서만 채워서 넘긴다(다른 액션엔 굳이 필요 없어서 기본
NULL). 세션 자체(활성 토큰 조회)는 Redis에 있고, 이 테이블은 그 반대로 "지나간
기록"을 영구 보관하는 역할 - 세션이 로그아웃/만료로 지워져도 이 로그는 남는다."""
from typing import Optional
from uuid import UUID

from app.db import pool


async def record_action(
    action: str,
    target_table: Optional[str],
    ip_address: Optional[str],
    user_id: Optional[UUID] = None,
    record_id: Optional[UUID] = None,
    user_agent: Optional[str] = None,
) -> None:
    async with pool().acquire() as conn:
        await conn.execute(
            """
            INSERT INTO audit_logs (user_id, action, target_table, ip_address, record_id, user_agent)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            user_id,
            action,
            target_table,
            ip_address,
            record_id,
            user_agent,
        )
