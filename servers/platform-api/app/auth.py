"""관리자 로그인/로그아웃/세션 (P5-2). users 테이블(001-schema.sql)의 실제 계정을
pgcrypto crypt()로 검증 - 더 이상 하드코딩된 단일 관리자 계정과 비교하지 않는다.

세션은 Redis에 session:{token} 키로 저장한다(TTL=settings.session_ttl_seconds) -
platform-api가 재시작돼도 Redis가 살아있으면 로그인이 유지된다. 이전엔 파이썬
메모리 딕셔너리라 재시작할 때마다 전원 로그아웃이었음 - dedupe/상관분석 윈도우에
이미 Redis를 쓰고 있어서(scenarios_api.py 등) 같은 인프라 재사용.

인증 강제는 앱 레벨(Depends)이 아니라 Traefik의 forwardAuth 미들웨어가 담당한다
(servers/docker-compose.yml의 platform-api-auth 미들웨어 -> 이 파일의 /verify를
호출). /login, /logout, /session, /verify는 그래서 Traefik의 platform-api-public
라우터(forwardAuth 미적용)로 붙는다 - /verify 자체가 인증 체크 로직이라 자기 자신을
막으면 안 되기 때문."""
import secrets
from typing import Optional
from uuid import UUID

import redis.asyncio as redis
from fastapi import APIRouter, Header, HTTPException, Request, Response
from pydantic import BaseModel

from app.audit import record_action
from app.config import settings
from app.db import pool

router = APIRouter(prefix="/auth", tags=["auth"])

_redis = redis.from_url(settings.redis_url, decode_responses=True)


async def stop() -> None:
    """앱 종료 시 커넥션 풀을 정리한다(2026-07-21) - db.py/clickhouse_client.py/
    opensearch_client.py는 전부 main.py의 on_shutdown에서 stop()이 불리는데, 이
    모듈은 그 목록에서 빠져 있었다. redis.from_url()이 지연 연결이라 당장 눈에
    띄는 장애로 이어지진 않지만(다른 서비스와 달리 시작 시점에 연결을 안 맺음),
    컨테이너 재시작/재배포마다(주로 dev 환경에서 hot-reload 시) 열린 소켓을
    반납하지 않고 그냥 프로세스만 죽는 게 반복된다."""
    await _redis.aclose()


class Session(BaseModel):
    user_id: UUID
    username: str
    role: str


def _session_key(token: str) -> str:
    return f"session:{token}"


async def _get_session(token: str) -> Optional[Session]:
    raw = await _redis.get(_session_key(token))
    return Session.model_validate_json(raw) if raw else None


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
    session_data = Session(user_id=row["id"], username=row["username"], role=row["role"])
    await _redis.set(_session_key(token), session_data.model_dump_json(), ex=settings.session_ttl_seconds)
    await record_action(
        "LOGIN",
        "users",
        _client_ip(request),
        user_id=row["id"],
        record_id=row["id"],
        user_agent=request.headers.get("user-agent"),
    )
    return LoginResponse(token=token)


@router.post("/logout")
async def logout(request: Request, authorization: Optional[str] = Header(default=None)):
    token = _extract_token(authorization)
    active_session = await _get_session(token)
    await _redis.delete(_session_key(token))
    await record_action(
        "LOGOUT",
        "users",
        _client_ip(request),
        user_id=active_session.user_id if active_session else None,
        record_id=active_session.user_id if active_session else None,
        user_agent=request.headers.get("user-agent"),
    )
    return {"status": "ok"}


@router.get("/session", response_model=SessionResponse)
async def session(authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        return SessionResponse(valid=False)
    token = authorization.removeprefix("Bearer ")
    active_session = await _get_session(token)
    if active_session is None:
        return SessionResponse(valid=False)
    return SessionResponse(valid=True, username=active_session.username, role=active_session.role)


@router.get("/verify")
async def verify(request: Request, response: Response):
    """Traefik forwardAuth(servers/docker-compose.yml의 platform-api-auth 미들웨어)가
    /api/auth, /api/health를 제외한 모든 /api/* 요청마다 먼저 호출하는 인증 게이트웨이.
    200이면 Traefik이 원 요청을 platform-api로 그대로 넘기고(X-Auth-* 헤더도 같이
    실어서 - authResponseHeaders 설정), 401/403이면 그 자리에서 요청이 막힌다.

    읽기(GET/HEAD/OPTIONS)는 로그인만 되어 있으면 통과, 쓰기(POST/PATCH/DELETE)는
    role=admin만 통과 - 기존 앱 레벨 get_current_session/require_admin과 동일한
    정책을 여기 하나로 모았다.

    Authorization 헤더만 본다(2026-07-21) - `?token=` 쿼리스트링 폴백은 원래
    브라우저 WebSocket API가 커스텀 헤더를 못 보내는 문제를 우회하려고 만들었는데,
    이 서비스에는 WebSocket 엔드포인트가 하나도 없다(계약 v1.1 §7 확정, main.py
    모듈 docstring 참고 - 대시보드는 주기 폴링 단일 모델). 폴백을 없앨 이유가 없어
    남겨뒀던 게 오히려 문제였다 - `/health`/`/auth/*` 제외 모든 요청이 이 경로를
    타므로, URL에 실린 세션 토큰이 서버 액세스 로그·프록시 로그·Referer 헤더에
    평문으로 남는 유출 경로가 실질적 기능 없이 계속 열려 있었다."""
    authorization = request.headers.get("authorization")
    token = authorization.removeprefix("Bearer ") if authorization and authorization.startswith("Bearer ") else None

    method = request.headers.get("x-forwarded-method", request.method).upper()
    if method == "OPTIONS":
        # CORS preflight - 브라우저가 Authorization 헤더를 안 실어 보내므로 여기서
        # 막으면 실제 요청이 나가기도 전에 프리플라이트가 401로 죽는다. 프리플라이트는
        # 인증이 필요 없고, 진짜 인증은 뒤따르는 본 요청에서 검사된다.
        return {"valid": True}

    session = await _get_session(token) if token else None
    if session is None:
        raise HTTPException(status_code=401, detail="invalid or expired token")

    if method not in ("GET", "HEAD") and session.role != "admin":
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


_GATEWAY_SECRET_HEADER = "x-internal-gateway-secret"


def verify_gateway_secret(request: Request) -> bool:
    """이 요청이 정말 Traefik을 거쳐왔는지 검증한다(감사 S13, 2026-07-16).

    current_user_id()가 X-Auth-User-Id를 "검증 없이 신뢰"할 수 있는 건 forwardAuth가
    이미 세션/역할 검사를 끝낸 뒤라는 전제 때문인데, platform-api:8400은 siem-net
    안의 다른 모든 컨테이너에서 직접 접근 가능하다(호스트 루프백 바인딩은 호스트
    바깥 접근만 막을 뿐 컨테이너 네트워크 안에서는 무관) - Traefik을 거치지 않고
    직접 붙으면 forwardAuth 자체가 아예 안 불리므로, X-Auth-* 헤더를 위조하지
    않아도(애초에 어떤 앱 코드도 쓰기 요청에 role을 재확인하지 않으므로) 쓰기가
    그냥 성공하고, current_user_id()로 감사 로그의 행위자도 위조할 수 있었다.

    servers/docker-compose.yml의 platform-api-gateway-secret 미들웨어(headers.
    customrequestheaders)가 Traefik을 거친 요청에는 이 헤더를 항상 주입해두므로,
    app/main.py의 전역 미들웨어가 모든 요청(주로 /health, /auth/verify 제외 -
    아래 참고)에서 이 값을 확인해 없거나 틀리면 403으로 거부한다 - 이제 direct
    bypass는 X-Auth-* 위조 여부와 무관하게 이 단계에서 막힌다.

    /health는 컨테이너 자신의 Docker healthcheck가 localhost로(Traefik을 안 거치고)
    직접 찌르므로 예외 처리 필수(app/main.py에서 처리). /auth/verify는 이 함수가
    검증하는 대상이 아니다 - forwardAuth의 내부 호출(Traefik이 자체 HTTP 클라이언트로
    http://platform-api:8400/auth/verify를 직접 호출) 자체가 라우터/미들웨어 체인을
    안 거치므로 게이트웨이 시크릿을 실어줄 방법이 없고, verify()는 애초에 X-Auth-*를
    입력으로 신뢰하는 게 아니라 세션 토큰으로 직접 판단해 X-Auth-*를 생성하는
    쪽이라 이 검증이 막아야 할 대상이 아니다(app/main.py에서 함께 예외 처리)."""
    provided = request.headers.get(_GATEWAY_SECRET_HEADER, "")
    return secrets.compare_digest(provided, settings.internal_gateway_secret)
