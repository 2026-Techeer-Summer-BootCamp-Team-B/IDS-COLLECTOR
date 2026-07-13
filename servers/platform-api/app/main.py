"""
플랫폼 API 서비스 (P5).

프론트엔드는 별도 팀/레포에서 만든다 - 이 서비스가 REST(+WebSocket) API로 유일한
연동 지점이다. 명세는 저장소 루트 README.md의 "프론트엔드 연동 API" 절 참고.

- 인시던트 API (P5-1): app/incidents_api.py - 목록/상세/상태 변경(open→investigating→closed) +
  timeline(incident_events를 OpenSearch와 조인한 스토리라인)
- ATT&CK 커버리지 API: app/attck_api.py - ids_shared.mitre_mapping 카탈로그 + incidents 집계
- IP 차단 기록 API: app/banned_ips_api.py - 기록/감사 트레일만(실제 방화벽 제어 없음)
- 인증 (P5-2): app/auth.py - login/logout/session, users 테이블(pgcrypto 해시) 실사용자 검증.
  get_current_session/require_admin 의존성으로 아래 모든 라우터에 로그인/role 강제 적용
  (읽기는 로그인만, 쓰기는 role=admin). WebSocket 릴레이는 헤더를 못 쓰는 브라우저 WS API
  특성상 `?token=` 쿼리스트링(get_ws_session)으로 검증. 세션은 아직 메모리 토큰 스토어
  (재시작 시 무효화), 영속화는 팀 설계 후 채울 것
- 알림 채널 (P5-3): app/notifications.py - WebSocket 릴레이에서 CRITICAL이면 발송
- AI 트렌드 리포트 (P5-4): app/ai_report.py - Anthropic API 미설정이면 통계만 반환
- Logs API: app/logs_api.py - attack-logs-* OpenSearch 인덱스 조회
- Stats API: app/stats_api.py(OpenSearch module/severity terms agg) +
  app/analytics_api.py(ClickHouse 시계열/GeoIP/K8s타겟/Top IP 집계) - 같은
  "/stats" prefix를 나눠 씀
- Scenario API: app/scenarios_api.py - 조회 + enabled 토글, Redis 키(scenario:enabled:{id})로
  correlation-engine에 즉시 반영(correlation-engine/app/rules.py ScenarioEngine.evaluate() 참고)
- AlertConfig API: app/alert_configs_api.py - Slack/Discord 웹훅 설정 CRUD,
  notifications.py가 이 테이블을 조회해서 실제 발송
- AuditLog API: app/audit_logs_api.py - 관리자 행위 감사 로그 조회
- WebSocket 릴레이(인시던트): app/websocket.py - 상관분석 엔진의 Redis pub/sub ->
  프론트엔드로 그대로 전달 (P4-4 발화 -> P7-1 실시간 피드를 잇는 지점)
- WebSocket 릴레이(개별 이벤트): app/event_stream.py - events.normalized를 직접
  tail해서 개별 정규화 이벤트를 /ws/events로 릴레이(하단 티커/CRITICAL 팝업이
  원하는 "개별 탐지" 단위 스트림 - 인시던트 단위인 /ws/incidents와는 별개)

실행 방법 (컨테이너): servers/docker-compose.yml 포함, 저장소 루트에서 `make up`
(또는 `docker compose -f servers/docker-compose.yml up -d --build`)으로 기동.
"""
import asyncio
import contextlib
from typing import Optional

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import clickhouse_client, db
from app.ai_report import generate_trend_report
from app.alert_configs_api import router as alert_configs_router
from app.analytics_api import router as analytics_router
from app.attck_api import router as attck_router
from app.audit_logs_api import router as audit_logs_router
from app.auth import get_current_session
from app.auth import router as auth_router
from app.banned_ips_api import router as banned_ips_router
from app.config import settings
from app.event_stream import relay_loop as events_relay_loop
from app.event_stream import router as event_stream_router
from app.incidents_api import router as incidents_router
from app.logs_api import router as logs_router
from app.scenarios_api import router as scenarios_router
from app.stats_api import router as stats_router
from app.websocket import relay_loop as incidents_relay_loop
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
app.include_router(analytics_router)
app.include_router(scenarios_router)
app.include_router(alert_configs_router)
app.include_router(audit_logs_router)
app.include_router(attck_router)
app.include_router(banned_ips_router)
app.include_router(ws_router)
app.include_router(event_stream_router)

_relay_task: Optional[asyncio.Task] = None
_event_relay_task: Optional[asyncio.Task] = None


@app.on_event("startup")
async def on_startup():
    global _relay_task, _event_relay_task
    await db.start()
    await clickhouse_client.start()
    _relay_task = asyncio.create_task(incidents_relay_loop())
    _event_relay_task = asyncio.create_task(events_relay_loop())


@app.on_event("shutdown")
async def on_shutdown():
    for task in (_relay_task, _event_relay_task):
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
    await clickhouse_client.stop()
    await db.stop()


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/reports/trend", dependencies=[Depends(get_current_session)])
async def trend_report(days: int = 7):
    return await generate_trend_report(days)
