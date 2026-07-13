"""관리자 로그인/로그아웃/세션 (P5-2). users 테이블(001-schema.sql)의 실제 계정을
pgcrypto crypt()로 검증 - 더 이상 하드코딩된 단일 관리자 계정과 비교하지 않는다.
세션은 여전히 메모리 토큰 스토어라 재시작하면 토큰이 전부 무효화된다 - 영속 토큰
저장소는 추후 교체 대상.

인증 강제는 앱 레벨(Depends)이 아니라 Traefik의 forwardAuth 미들웨어가 담당한다
(servers/docker-compose.yml의 platform-api-auth 미들웨어 -> 이 파일의 /verify를
호출). /login, /logout, /session, /verify는 그래서 Traefik의 platform-api-public
라우터(forwardAuth 미적용)로 붙는다 - /verify 자체가 인증 체크 로직이라 자기 자신을
막으면 안 되기 때문."""
import secrets
from typing import Dict, Optional
from urllib.parse import parse_qs, urlsplit
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Request, Response
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


def _token_from_forwarded_uri(request: Request) -> Optional[str]:
    """브라우저 WebSocket API는 커스텀 헤더를 못 보내므로 프론트가 `?token=` 쿼리스트링으로
    토큰을 실어 보낸다 - forwardAuth가 원본 요청 경로+쿼리를 그대로 담아주는
    X-Forwarded-Uri에서 꺼낸다."""
    forwarded_uri = request.headers.get("x-forwarded-uri", "")
    query = urlsplit(forwarded_uri).query
    if not query:
        return None
    return parse_qs(query).get("token", [None])[0]


@router.get("/verify")
async def verify(request: Request, response: Response):
    """Traefik forwardAuth(servers/docker-compose.yml의 platform-api-auth 미들웨어)가
    /api/auth, /api/health를 제외한 모든 /api/* 요청마다 먼저 호출하는 인증 게이트웨이.
    200이면 Traefik이 원 요청을 platform-api로 그대로 넘기고(X-Auth-* 헤더도 같이
    실어서 - authResponseHeaders 설정), 401/403이면 그 자리에서 요청이 막힌다.

    읽기(GET/HEAD/OPTIONS - WS 핸드셰이크도 업그레이드 이전엔 GET)는 로그인만 되어
    있으면 통과, 쓰기(POST/PATCH/DELETE)는 role=admin만 통과 - 기존 앱 레벨
    get_current_session/require_admin과 동일한 정책을 여기 하나로 모았다."""
    authorization = request.headers.get("authorization")
    token = authorization.removeprefix("Bearer ") if authorization and authorization.startswith("Bearer ") else None
    if token is None:
        token = _token_from_forwarded_uri(request)

    session = _active_tokens.get(token) if token else None
    if session is None:
        raise HTTPException(status_code=401, detail="invalid or expired token")

    method = request.headers.get("x-forwarded-method", request.method).upper()
    if method not in ("GET", "HEAD", "OPTIONS") and session.role != "admin":
        raise HTTPException(status_code=403, detail="admin role required")

    response.headers["X-Auth-User-Id"] = str(session.user_id)
    response.headers["X-Auth-Username"] = session.username
    response.headers["X-Auth-Role"] = session.role
    return {"valid": True}


def current_user_id(request: Request) -> Optional[UUID]:
    """/verify가 통과시키면서 실어준 X-Auth-User-Id를 감사 로그용으로 읽기만 한다 -
    인증 자체는 이미 Traefik forwardAuth가 끝낸 뒤라 여기선 검증 없이 신뢰한다."""
    raw = request.headers.get("x-auth-user-id")
    return UUID(raw) if raw else None
