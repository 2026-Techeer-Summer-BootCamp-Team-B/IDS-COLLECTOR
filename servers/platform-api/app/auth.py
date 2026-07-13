"""관리자 로그인/로그아웃/세션 (P5-2). users 테이블(001-schema.sql)의 실제 계정을
pgcrypto crypt()로 검증 - 더 이상 하드코딩된 단일 관리자 계정과 비교하지 않는다.
세션은 여전히 메모리 토큰 스토어라 재시작하면 토큰이 전부 무효화된다 - 영속 토큰
저장소는 추후 교체 대상."""
import secrets
from typing import Dict, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request, WebSocket, WebSocketException, status
from pydantic import BaseModel

from app.audit import record_action
from app.db import pool

router = APIRouter(prefix="/auth", tags=["auth"])


class Session(BaseModel):
    user_id: UUID
    username: str
    role: str


_active_tokens: Dict[str, Session] = {}


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str


class SessionResponse(BaseModel):
    valid: bool
    username: Optional[str] = None
    role: Optional[str] = None


def _client_ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _extract_token(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    return authorization.removeprefix("Bearer ")


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, request: Request):
    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, username, role
            FROM users
            WHERE username = $1 AND password_hash = crypt($2, password_hash)
            """,
            body.username,
            body.password,
        )
    if row is None:
        raise HTTPException(status_code=401, detail="invalid credentials")

    token = secrets.token_urlsafe(32)
    _active_tokens[token] = Session(user_id=row["id"], username=row["username"], role=row["role"])
    await record_action("LOGIN", "users", _client_ip(request), user_id=row["id"])
    return LoginResponse(token=token)


@router.post("/logout")
async def logout(request: Request, authorization: Optional[str] = Header(default=None)):
    token = _extract_token(authorization)
    session = _active_tokens.pop(token, None)
    await record_action("LOGOUT", "users", _client_ip(request), user_id=session.user_id if session else None)
    return {"status": "ok"}


@router.get("/session", response_model=SessionResponse)
async def session(authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        return SessionResponse(valid=False)
    token = authorization.removeprefix("Bearer ")
    active_session = _active_tokens.get(token)
    if active_session is None:
        return SessionResponse(valid=False)
    return SessionResponse(valid=True, username=active_session.username, role=active_session.role)


async def get_current_session(authorization: Optional[str] = Header(default=None)) -> Session:
    """다른 라우터가 `Depends(get_current_session)`로 붙여서 로그인(유효한 세션)을 강제하는 용도."""
    token = _extract_token(authorization)
    session = _active_tokens.get(token)
    if session is None:
        raise HTTPException(status_code=401, detail="invalid or expired token")
    return session


async def require_admin(session: Session = Depends(get_current_session)) -> Session:
    """쓰기(POST/PATCH/DELETE) 라우트가 `Depends(require_admin)`으로 붙여서 admin role만 허용."""
    if session.role != "admin":
        raise HTTPException(status_code=403, detail="admin role required")
    return session


async def get_ws_session(websocket: WebSocket) -> Session:
    """브라우저 WebSocket API가 커스텀 헤더를 못 보내므로 `?token=` 쿼리스트링으로 검증
    (README의 WS 연결 URL 계약이 이 파라미터를 요구하도록 바뀜)."""
    token = websocket.query_params.get("token")
    session = _active_tokens.get(token) if token else None
    if session is None:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION)
    return session
