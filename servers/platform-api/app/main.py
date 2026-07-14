"""
플랫폼 API 서비스 (P5).

프론트엔드는 별도 팀/레포에서 만든다 - 이 서비스가 REST(+WebSocket) API로 유일한
연동 지점이다. 명세는 저장소 루트 README.md의 "프론트엔드 연동 API" 절 참고.

- 인시던트 API (P5-1): app/incidents_api.py - 목록/상세/상태 변경(open→investigating→closed) +
  timeline(incident_events를 OpenSearch와 조인한 스토리라인)
- ATT&CK 커버리지 API: app/attck_api.py - ids_shared.mitre_mapping 카탈로그 + incidents 집계
- IP 차단 기록 API: app/banned_ips_api.py - 기록/감사 트레일만(실제 방화벽 제어 없음)
- 인증 (P5-2): app/auth.py - login/logout/session, users 테이블(pgcrypto 해시) 실사용자 검증.
  인증 강제는 앱(Depends)이 아니라 Traefik forwardAuth가 담당(servers/docker-compose.yml의
  platform-api-auth 미들웨어 -> app/auth.py의 GET /auth/verify 호출, 200이면 X-Auth-User-Id/
  X-Auth-Username/X-Auth-Role 헤더를 실어 원 요청을 통과시킴) - 읽기(GET, WS 핸드셰이크
  포함)는 로그인만, 쓰기(POST/PATCH/DELETE)는 role=admin만 통과. WebSocket(/ws/events)은
  브라우저가 커스텀 헤더를 못 보내서 `?token=` 쿼리스트링으로 토큰을 받아 /verify가
  X-Forwarded-Uri에서 파싱한다. 세션은 Redis에 저장(session:{token}, TTL=
  settings.session_ttl_seconds)돼 재시작에도 살아남는다. 주의: platform-api:8400
  직결 포트(로컬 디버깅용)는 Traefik을 안 거치므로 이 인증이 전혀 적용되지 않는다
- 알림 채널 (P5-3): app/notifications.py - app/incident_alerts.py가 notified_at IS NULL인
  인시던트를 폴링해서 발송(트리거)
- AI 트렌드 리포트 (P5-4): app/ai_report.py - Anthropic API 미설정이면 통계만 반환
- Logs API: app/logs_api.py - attack-logs-* OpenSearch 인덱스 조회
- Stats API: app/stats_api.py(OpenSearch module/severity terms agg) +
  app/analytics_api.py(ClickHouse 시계열/GeoIP/K8s타겟/Top IP 집계) +
  app/pipeline_health_api.py(컨슈머 lag/DLQ 깊이/클록 차이 - 자체 파이프라인 헬스,
  Kafka AdminClient + OpenSearch 표본) - 같은 "/stats" prefix를 셋으로 나눠 씀
- Scenario API: app/scenarios_api.py - 조회 + enabled 토글, Redis 키(scenario:enabled:{id})로
  correlation-engine에 즉시 반영(correlation-engine/app/rules.py ScenarioEngine.evaluate() 참고)
- AlertConfig API: app/alert_configs_api.py - Slack/Discord 웹훅 설정 CRUD,
  notifications.py가 이 테이블을 조회해서 실제 발송
- AuditLog API: app/audit_logs_api.py - 관리자 행위 감사 로그 조회
- Target API: app/targets_api.py - 보호 대상 애플리케이션 등록 CRUD(파이프라인 소비는 아직 없음)
- Allow-list API: app/allow_list_api.py - 탐지 예외 IP/대역 CRUD, target_id로 스코프 가능
- User API: app/users_api.py - 관리자 계정 CRUD(users 테이블 - auth.py 로그인이 참조하는
  그 테이블), 감사 로그의 user_id를 username으로 조인할 수 있게 됨(audit_logs_api.py 참고)
  (파이프라인이 실제로 걸러내는 로직은 아직 없음 - 등록/관리까지만)
- 인시던트 실시간 팝업(P7-1): 전용 엔드포인트 없음 - 프론트가 GET /incidents?since=
  <마지막_확인_시각>을 3~5초 주기로 폴링해서 새 CRITICAL 인시던트를 감지한다
  (2026-07-13 이전엔 WebSocket(/ws/incidents)으로 push했으나 제거됨 - app/incident_alerts.py
  참고). 일반 Authorization 헤더로 인증되므로 WS `?token=` 우회가 필요 없다.
- WebSocket 릴레이(개별 이벤트): app/event_stream.py - events.normalized를 직접
  tail해서 개별 정규화 이벤트를 /ws/events로 릴레이(하단 티커용 "개별 탐지" 단위
  스트림 - 인시던트 단위 팝업은 위처럼 GET /incidents?since= 폴링으로 따로 처리)

실행 방법 (컨테이너): servers/docker-compose.yml 포함, 저장소 루트에서 `make up`
(또는 `docker compose -f servers/docker-compose.yml up -d --build`)으로 기동.
"""
import asyncio
import contextlib
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import clickhouse_client, db
from app.ai_report import generate_trend_report
from app.alert_configs_api import router as alert_configs_router
from app.analytics_api import router as analytics_router
from app.allow_list_api import router as allow_list_router
from app.attck_api import router as attck_router
from app.audit_logs_api import router as audit_logs_router
from app.auth import router as auth_router
from app.banned_ips_api import router as banned_ips_router
from app.config import settings
from app.event_stream import relay_loop as events_relay_loop
from app.event_stream import router as event_stream_router
from app.incident_alerts import poll_loop as incident_alerts_poll_loop
from app.incidents_api import router as incidents_router
from app.logs_api import router as logs_router
from app.pipeline_health_api import router as pipeline_health_router
from app.scenarios_api import router as scenarios_router
from app.stats_api import router as stats_router
from app.targets_api import router as targets_router
from app.users_api import router as users_router

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
app.include_router(pipeline_health_router)
app.include_router(scenarios_router)
app.include_router(alert_configs_router)
app.include_router(audit_logs_router)
app.include_router(attck_router)
app.include_router(banned_ips_router)
app.include_router(targets_router)
app.include_router(users_router)
app.include_router(allow_list_router)
app.include_router(event_stream_router)

_alert_poll_task: Optional[asyncio.Task] = None
_event_relay_task: Optional[asyncio.Task] = None


@app.on_event("startup")
async def on_startup():
    global _alert_poll_task, _event_relay_task
    await db.start()
    await clickhouse_client.start()
    _alert_poll_task = asyncio.create_task(incident_alerts_poll_loop())
    _event_relay_task = asyncio.create_task(events_relay_loop())


@app.on_event("shutdown")
async def on_shutdown():
    for task in (_alert_poll_task, _event_relay_task):
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
    await clickhouse_client.stop()
    await db.stop()


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/reports/trend")
async def trend_report(days: int = 7):
    return await generate_trend_report(days)
