"""관리자 로그인/로그아웃/세션 (P5-2). Target에서 플랫폼으로 이관 예정 - 스펙 미설계라
지금은 단일 관리자 계정 + 메모리 토큰 스토어로 된 스텁. 재시작하면 토큰이 전부
무효화된다 - 실제 이관 시 역할(RBAC) 모델과 영속 토큰 저장소로 교체할 것."""
import secrets
from typing import Optional, Set

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

from app.audit import record_action
from app.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])

_active_tokens: Set[str] = set()


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str


class SessionResponse(BaseModel):
    valid: bool
    username: Optional[str] = None


def _client_ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _extract_token(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    return authorization.removeprefix("Bearer ")


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, request: Request):
    if body.username != settings.admin_username or body.password != settings.admin_password:
        raise HTTPException(status_code=401, detail="invalid credentials")
    token = secrets.token_urlsafe(32)
    _active_tokens.add(token)
    await record_action("LOGIN", "users", _client_ip(request))
    return LoginResponse(token=token)


@router.post("/logout")
async def logout(request: Request, authorization: Optional[str] = Header(default=None)):
    token = _extract_token(authorization)
    _active_tokens.discard(token)
    await record_action("LOGOUT", "users", _client_ip(request))
    return {"status": "ok"}


@router.get("/session", response_model=SessionResponse)
async def session(authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        return SessionResponse(valid=False)
    token = authorization.removeprefix("Bearer ")
    if token not in _active_tokens:
        return SessionResponse(valid=False)
    return SessionResponse(valid=True, username=settings.admin_username)


def is_valid_token(token: str) -> bool:
    return token in _active_tokens
