"""
플랫폼 API 서비스 (P5).

프론트엔드는 별도 팀/레포에서 만든다 - 이 서비스가 REST(+WebSocket) API로 유일한
연동 지점이다. 명세는 저장소 루트 README.md의 "프론트엔드 연동 API" 절 참고.

- 인시던트 API (P5-1): app/incidents_api.py - 목록/상세/상태 변경(open→investigating→closed)
- 인증 (P5-2): app/auth.py - login/logout/session 스텁, 실제 이관/역할 모델은 팀 설계 후 채울 것
- 알림 채널 (P5-3): app/notifications.py - WebSocket 릴레이에서 CRITICAL이면 발송
- AI 트렌드 리포트 (P5-4): app/ai_report.py - Anthropic API 미설정이면 통계만 반환
- Logs API: app/logs_api.py - attack-logs-* OpenSearch 인덱스 조회
- Stats API: app/stats_api.py - 소스별/심각도별 집계
- Scenario API [TBD]: app/scenarios_api.py - 조회 + enabled 토글 (correlation-engine이
  이 값을 평가에 실제로 반영하는지는 별도 확인 필요 - 스켈레톤)
- AlertConfig API: app/alert_configs_api.py - Slack/Discord 웹훅 설정 CRUD (스켈레톤,
  notifications.py는 아직 이 테이블을 안 읽음)
- AuditLog API: app/audit_logs_api.py - 관리자 행위 감사 로그 조회
- WebSocket 릴레이: app/websocket.py - 상관분석 엔진의 Redis pub/sub -> 프론트엔드로
  그대로 전달 (P4-4 발화 -> P7-1 실시간 피드를 잇는 지점)

실행 방법 (컨테이너): servers/docker-compose.yml 포함, 저장소 루트에서 `make up`
(또는 `docker compose -f servers/docker-compose.yml up -d --build`)으로 기동.
"""
import asyncio
import contextlib
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import db
from app.ai_report import generate_trend_report
from app.alert_configs_api import router as alert_configs_router
from app.audit_logs_api import router as audit_logs_router
from app.auth import router as auth_router
from app.config import settings
from app.incidents_api import router as incidents_router
from app.logs_api import router as logs_router
from app.scenarios_api import router as scenarios_router
from app.stats_api import router as stats_router
from app.websocket import relay_loop
from app.websocket import router as ws_router

app = FastAPI(title="IDS Platform API")

# 프론트엔드가 다른 origin(별도 레포/도메인)에서 호출하므로 CORS를 열어둔다.
# 쿠키 기반 인증이 아니라 로그인 응답의 토큰을 프론트가 직접 들고 다니는 방식이라
# allow_credentials 없이 "*" 허용이어도 안전.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(incidents_router)
app.include_router(auth_router)
app.include_router(logs_router)
app.include_router(stats_router)
app.include_router(scenarios_router)
app.include_router(alert_configs_router)
app.include_router(audit_logs_router)
app.include_router(ws_router)

_relay_task: Optional[asyncio.Task] = None


@app.on_event("startup")
async def on_startup():
    global _relay_task
    await db.start()
    _relay_task = asyncio.create_task(relay_loop())


@app.on_event("shutdown")
async def on_shutdown():
    if _relay_task:
        _relay_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _relay_task
    await db.stop()


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/reports/trend")
async def trend_report(days: int = 7):
    return await generate_trend_report(days)
