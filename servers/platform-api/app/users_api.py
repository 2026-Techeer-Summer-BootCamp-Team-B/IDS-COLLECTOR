"""User API (/users) - 관리자 계정 CRUD. users 테이블(001-schema.sql)은 auth.py의
로그인 검증이 이미 참조하고 있었지만, 계정을 추가/변경/삭제하는 API가 없어서 관리자가
새 계정을 만들 방법이 없었고 감사 로그의 user_id도 이름으로 못 바꾸고 있었다
(audit_logs_api.py 참고). 계정 생성/비밀번호 변경은 001-schema.sql이 이미 켜둔
pgcrypto의 crypt()/gen_salt('bf')로 해시(auth.py의 로그인 검증과 동일한 해시 방식).

쓰기(POST/PATCH/DELETE)는 targets_api.py 등과 마찬가지로 앱 레벨에서 role 체크를
하지 않는다 - Traefik forwardAuth(auth.py의 /verify)가 이미 GET 외 모든 /api/*
요청에 role=admin을 강제하고 있어서 여기서 중복 체크할 필요가 없다.
"""
from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.audit import record_action
from app.auth import current_user_id
from app.db import pool

router = APIRouter(prefix="/users", tags=["users"])


def _client_ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


class UserIn(BaseModel):
    username: str
    password: str
    role: Literal["admin", "viewer"] = "viewer"


class UserUpdate(BaseModel):
    role: Optional[Literal["admin", "viewer"]] = None
    password: Optional[str] = None


class UserOut(BaseModel):
    id: str
    username: str
    role: str
    created_at: str


def _row_to_out(row) -> UserOut:
    return UserOut(
        id=str(row["id"]),
        username=row["username"],
        role=row["role"],
        created_at=row["created_at"].isoformat(),
    )


async def _remaining_admin_count(conn, exclude_user_id: str) -> int:
    return await conn.fetchval(
        "SELECT count(*) FROM users WHERE role = 'admin' AND id != $1", exclude_user_id
    )


@router.get("", response_model=List[UserOut])
async def list_users():
    async with pool().acquire() as conn:
        rows = await conn.fetch("SELECT id, username, role, created_at FROM users ORDER BY created_at")
    return [_row_to_out(r) for r in rows]


@router.post("", response_model=UserOut)
async def create_user(body: UserIn, request: Request):
    async with pool().acquire() as conn:
        exists = await conn.fetchval("SELECT 1 FROM users WHERE username = $1", body.username)
        if exists:
            raise HTTPException(status_code=409, detail="이미 존재하는 username입니다")
        row = await conn.fetchrow(
            """
            INSERT INTO users (username, password_hash, role)
            VALUES ($1, crypt($2, gen_salt('bf')), $3)
            RETURNING id, username, role, created_at
            """,
            body.username,
            body.password,
            body.role,
        )
    await record_action(
        "USER_CREATED", "users", _client_ip(request), user_id=current_user_id(request), record_id=row["id"]
    )
    return _row_to_out(row)


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(user_id: str, body: UserUpdate, request: Request):
    async with pool().acquire() as conn:
        current = await conn.fetchrow("SELECT id, role FROM users WHERE id = $1", user_id)
        if not current:
            raise HTTPException(status_code=404, detail="user not found")

        # 마지막 admin을 viewer로 강등하면 아무도 관리 화면(쓰기 작업)에 못 들어오게
        # 되므로 막는다 - 삭제와 동일한 안전장치(아래 delete_user 참고).
        if body.role == "viewer" and current["role"] == "admin":
            if await _remaining_admin_count(conn, user_id) == 0:
                raise HTTPException(status_code=409, detail="마지막 admin 계정은 강등할 수 없습니다")

        if body.password:
            row = await conn.fetchrow(
                """
                UPDATE users SET role = COALESCE($2, role), password_hash = crypt($3, gen_salt('bf'))
                WHERE id = $1
                RETURNING id, username, role, created_at
                """,
                user_id,
                body.role,
                body.password,
            )
        else:
            row = await conn.fetchrow(
                """
                UPDATE users SET role = COALESCE($2, role) WHERE id = $1
                RETURNING id, username, role, created_at
                """,
                user_id,
                body.role,
            )
    await record_action(
        "USER_UPDATED", "users", _client_ip(request), user_id=current_user_id(request), record_id=user_id
    )
    return _row_to_out(row)


@router.delete("/{user_id}")
async def delete_user(user_id: str, request: Request):
    async with pool().acquire() as conn:
        current = await conn.fetchrow("SELECT id, role FROM users WHERE id = $1", user_id)
        if not current:
            raise HTTPException(status_code=404, detail="user not found")
        if current["role"] == "admin" and await _remaining_admin_count(conn, user_id) == 0:
            raise HTTPException(status_code=409, detail="마지막 admin 계정은 삭제할 수 없습니다")
        await conn.execute("DELETE FROM users WHERE id = $1", user_id)
    await record_action(
        "USER_DELETED", "users", _client_ip(request), user_id=current_user_id(request), record_id=user_id
    )
    return {"status": "ok"}
