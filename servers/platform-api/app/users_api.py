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
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.audit import record_action
from app.auth import current_user_id
from app.db import pool

router = APIRouter(prefix="/users", tags=["users"])

_MIN_PASSWORD_LENGTH = 8


def _client_ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _validate_password(password: str) -> None:
    """pgcrypto crypt()는 빈 문자열도 그냥 해시해버려서, 이 검사가 없으면 빈
    비밀번호(또는 몇 글자짜리)로 계정을 만들거나 바꿀 수 있었다 - 저장/로그인
    둘 다 아무 에러 없이 성공한다."""
    if len(password) < _MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"password must be at least {_MIN_PASSWORD_LENGTH} characters",
        )


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


async def _remaining_admin_count(conn, exclude_user_id: UUID) -> int:
    return await conn.fetchval(
        "SELECT count(*) FROM users WHERE role = 'admin' AND id != $1", exclude_user_id
    )


# "남은 admin 수 확인 -> 삭제/강등" 사이의 TOCTOU 레이스 방지용 뮤텍스(2026-07-21).
# count(*)는 집계라 SELECT ... FOR UPDATE로 잠글 수 없어서(Postgres가 거부),
# 대신 "admin 수를 줄일 수 있는 모든 트랜잭션이 공유하는 단일 어드바이저리 락"으로
# 직렬화한다. admin이 정확히 2명일 때 delete_user(A)와 update_user(B, role=viewer)가
# 동시에 들어오면, 트랜잭션으로 안 묶인 예전 코드는 서로가 아직 안 지워진/안
# 강등된 상대방을 보고 둘 다 통과해서 admin이 0명이 되어 모든 쓰기 API가
# 잠기는 사고로 이어졌다(users_api.py, 2026-07-21 실측 확인). 이 락은 두 endpoint가
# 공유하는 키를 써서 delete<->delete, update<->update, delete<->update 조합
# 전부를 막는다.
_ADMIN_COUNT_LOCK_KEY = "platform-api:users:admin_count"


async def _lock_admin_count(conn) -> None:
    """admin 수를 줄이는 트랜잭션끼리 직렬화하는 트랜잭션 스코프 락 - 호출하는
    쪽이 반드시 `async with conn.transaction():` 안에서 호출해야 한다
    (pg_advisory_xact_lock은 COMMIT/ROLLBACK 시 자동 해제되고, 명시적 트랜잭션이
    없으면 각 쿼리가 자기 자신만의 암시적 트랜잭션으로 끝나 락이 다음 쿼리로 안
    이어진다)."""
    await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", _ADMIN_COUNT_LOCK_KEY)


@router.get("", response_model=List[UserOut])
async def list_users():
    async with pool().acquire() as conn:
        rows = await conn.fetch("SELECT id, username, role, created_at FROM users ORDER BY created_at")
    return [_row_to_out(r) for r in rows]


@router.post("", response_model=UserOut)
async def create_user(body: UserIn, request: Request):
    _validate_password(body.password)
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
async def update_user(user_id: UUID, body: UserUpdate, request: Request):
    async with pool().acquire() as conn:
        async with conn.transaction():
            current = await conn.fetchrow("SELECT id, role FROM users WHERE id = $1", user_id)
            if not current:
                raise HTTPException(status_code=404, detail="user not found")

            # 마지막 admin을 viewer로 강등하면 아무도 관리 화면(쓰기 작업)에 못 들어오게
            # 되므로 막는다 - 삭제와 동일한 안전장치(아래 delete_user 참고). 잠금은
            # 실제로 admin 수를 줄일 수 있는 이 분기에서만 잡는다(비밀번호 변경/
            # viewer->admin 승격은 admin 수를 줄이지 않으므로 직렬화할 필요 없음).
            if body.role == "viewer" and current["role"] == "admin":
                await _lock_admin_count(conn)
                if await _remaining_admin_count(conn, user_id) == 0:
                    raise HTTPException(status_code=409, detail="마지막 admin 계정은 강등할 수 없습니다")

            if body.password:
                _validate_password(body.password)
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
async def delete_user(user_id: UUID, request: Request):
    async with pool().acquire() as conn:
        async with conn.transaction():
            current = await conn.fetchrow("SELECT id, role FROM users WHERE id = $1", user_id)
            if not current:
                raise HTTPException(status_code=404, detail="user not found")
            if current["role"] == "admin":
                await _lock_admin_count(conn)
                if await _remaining_admin_count(conn, user_id) == 0:
                    raise HTTPException(status_code=409, detail="마지막 admin 계정은 삭제할 수 없습니다")
            await conn.execute("DELETE FROM users WHERE id = $1", user_id)
    await record_action(
        "USER_DELETED", "users", _client_ip(request), user_id=current_user_id(request), record_id=user_id
    )
    return {"status": "ok"}
