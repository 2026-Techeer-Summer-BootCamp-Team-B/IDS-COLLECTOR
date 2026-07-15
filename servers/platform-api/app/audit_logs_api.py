"""AuditLog API (/audit-logs) - 관리자 행위 감사 로그 조회."""
from typing import Any, List, Optional

from fastapi import APIRouter, Response
from pydantic import BaseModel

from app.db import pool
from app.pagination import decode_cursor, set_next_cursor_header
from app.timeparse import parse_iso8601

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
async def list_audit_logs(response: Response, limit: int = 50, cursor: Optional[str] = None):
    """limit은 한 페이지 크기다 - 예전엔 이게 "조회 가능한 전체 상한"이라 500건이
    넘게 쌓인 과거 감사 로그는 API로 영원히 못 봤다(2026-07-15, /incidents
    (incidents_api.py)와 동일한 키셋 커서 페이지네이션 추가로 해소). 응답이
    꽉 찼으면(=limit건 그대로 돌아옴, 더 있을 수 있음) X-Next-Cursor 헤더가
    실려온다 - 그 값을 다음 호출의 cursor로 그대로 넘기면 더 오래된 로그가
    이어서 나온다."""
    limit = min(limit, 500)
    params: List[Any] = []
    where = ""
    if cursor:
        cursor_created_at, cursor_id = decode_cursor(cursor)
        params.append(parse_iso8601(cursor_created_at))
        ts_param = len(params)
        params.append(cursor_id)
        id_param = len(params)
        # 튜플(row constructor) 비교 - created_at이 같은 행이 여러 개 있어도
        # id(uuid, 항상 유일)를 2차 정렬키로 같이 비교해서 건너뛰거나 중복되지 않는다.
        where = f"WHERE (a.created_at, a.id) < (${ts_param}, ${id_param})"
    params.append(limit)

    async with pool().acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT a.id, a.user_id, u.username, a.action, a.target_table, a.record_id,
                   a.ip_address, a.user_agent, a.created_at
            FROM audit_logs a
            LEFT JOIN users u ON u.id = a.user_id
            {where}
            ORDER BY a.created_at DESC, a.id DESC LIMIT ${len(params)}
            """,
            *params,
        )

    if len(rows) == limit:
        last = rows[-1]
        set_next_cursor_header(response, [last["created_at"].isoformat(), str(last["id"])])

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
