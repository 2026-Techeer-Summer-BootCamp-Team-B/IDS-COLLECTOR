"""
플랫폼 API 서비스 (P5).

프론트엔드는 별도 팀/레포에서 만든다 - 이 서비스가 REST API로 유일한 연동 지점이다
(계약 v1.1 §7 확정: 대시보드는 주기 폴링 단일 모델, WebSocket/Redis pub/sub 경로는
없음). 명세는 저장소 루트 README.md의 "프론트엔드 연동 API" 절 참고.

- 인시던트 API (P5-1): app/incidents_api.py - 목록/상세/상태 변경(open→investigating→closed) +
  timeline(incident_events를 OpenSearch와 조인한 스토리라인)
- ATT&CK 커버리지 API: app/attck_api.py - ids_shared.mitre_mapping 카탈로그 + incidents 집계
- IP 차단 기록 API: app/banned_ips_api.py - 기록/감사 트레일만(실제 방화벽 제어 없음)
- 인증 (P5-2): app/auth.py - login/logout/session, users 테이블(pgcrypto 해시) 실사용자 검증.
  인증 강제는 앱(Depends)이 아니라 Traefik forwardAuth가 담당(servers/docker-compose.yml의
  platform-api-auth 미들웨어 -> app/auth.py의 GET /auth/verify 호출, 200이면 X-Auth-User-Id/
  X-Auth-Username/X-Auth-Role 헤더를 실어 원 요청을 통과시킴) - 읽기(GET)는 로그인만,
  쓰기(POST/PATCH/DELETE)는 role=admin만 통과. 세션은 Redis에 저장(session:{token}, TTL=
  settings.session_ttl_seconds)돼 재시작에도 살아남는다. 주의: platform-api:8400
  직결 포트(로컬 디버깅용, servers/docker-compose.yml에서 호스트 127.0.0.1에만
  바인딩됨)는 Traefik을 안 거치므로 이 인증이 전혀 적용되지 않는다 - GCP VM 등
  원격 호스트에서 이 포트로 붙으려면 SSH 터널이 필요하다(예: ssh -L 8400:localhost:8400 <host>).
  단, siem-net 컨테이너 네트워크 안에서 platform-api:8400에 직접 붙는 경로는
  루프백 바인딩과 무관하게 항상 열려 있어서(감사 S13, 2026-07-16) 게이트웨이
  시크릿 미들웨어(아래 enforce_gateway_secret, app/auth.py의 verify_gateway_secret())를
  추가로 뒀다 - Traefik이 라우팅한 요청에만 주입되는 X-Internal-Gateway-Secret이
  없으면 /health·/auth/verify를 제외한 전 요청을 403으로 거부한다.
- 알림 채널 (P5-3): app/notifications.py - app/incident_alerts.py가 notified_at IS NULL인
  인시던트를 폴링해서 발송(트리거)
- AI 트렌드 리포트 (P5-4): app/ai_report.py - Gemini API 미설정이면 통계만 반환.
  POST /reports/trend/notify(아래)가 요약을 app/notifications.py의 notify_text()로
  넘겨 Slack/Discord로도 발송 - 생성(ai_report.py)과 발송(notifications.py)은
  이 라우트에서만 조합되고 두 모듈은 서로 import하지 않는다
- Logs API: app/logs_api.py - attack-logs-* OpenSearch 인덱스 조회
- Events API(개별 이벤트 티커): app/events_api.py - GET /events/recent?since=&limit=,
  attack-logs-* OpenSearch 인덱스를 since 폴링(대시보드 하단 티커/CRITICAL 팝업이 소비 -
  2026-07-14부로 WebSocket(/ws/events, app/event_stream.py) 직접 tail 방식을 대체)
- Stats API: app/stats_api.py(OpenSearch module/severity terms agg) +
  app/analytics_api.py(ClickHouse 시계열/GeoIP/K8s타겟/Top IP 집계) +
  app/pipeline_health_api.py(컨슈머 lag/DLQ 깊이/클록 차이 - 자체 파이프라인 헬스,
  Kafka AdminClient + OpenSearch 표본) - 같은 "/stats" prefix를 셋으로 나눠 씀
- Scenario API: app/scenarios_api.py - 조회 + enabled 토글, Redis 키(scenario:enabled:{id})로
  correlation-engine에 즉시 반영(correlation-engine/app/rules.py ScenarioEngine.evaluate() 참고)
- AlertConfig API: app/alert_configs_api.py - Slack/Discord 웹훅 설정 CRUD,
  notifications.py가 이 테이블을 조회해서 실제 발송
- 리포트 알림 연동 API (P8, OAuth는 목업): app/report_notifications_api.py - 사용자별
  Slack/Discord 연동 CRUD(access_token은 app/crypto_utils.py로 암호화 저장) + 최근
  발송 이력 조회. AlertConfig(인시던트 실시간, 고정 webhook)와 달리 계정별로 분리되고
  app/report_notification_service.py(Block Kit/Embed 변환 + 목업 발송)가 소비 -
  POST /reports/trend/notify가 source='scheduled'일 때만 호출(app/main.py 아래 참고)
- AuditLog API: app/audit_logs_api.py - 관리자 행위 감사 로그 조회
- Target API: app/targets_api.py - 보호 대상 애플리케이션 등록 CRUD(파이프라인 소비는 아직 없음)
- Allow-list API: app/allow_list_api.py - 탐지 예외 IP/대역 CRUD, target_id로 스코프 가능
- User API: app/users_api.py - 관리자 계정 CRUD(users 테이블 - auth.py 로그인이 참조하는
  그 테이블), 감사 로그의 user_id를 username으로 조인할 수 있게 됨(audit_logs_api.py 참고)
  (파이프라인이 실제로 걸러내는 로직은 아직 없음 - 등록/관리까지만)
- 데이터 정책 API: app/data_policy_api.py - 로그 보존(/log-policies) CRUD, 3등급
  체계(기록/원본/파생, 2026-07-16)로 재정의됨(datastore/postgres/init/
  023-log-policies-retention-tiers.sql). AdminAuditView.jsx의 useLogPolicies 훅이
  이 API를 호출하나 새 응답 스키마(retention_days 단일 필드)에는 아직 안 맞음
  (docs/reports/retention-patch-20260716.md 참고 - 프론트 반영은 별도 작업).
  보존기간(retention_days/archive_enabled)은 app/log_retention.py가 실제로
  집행한다(오래된 attack-logs-*/otel-logs-raw-* 인덱스 통삭제 + audit_logs/
  incidents 정리). 제외 규칙(/exclusion-rules,
  exclusion_rules 기반 저가치 노이즈 자동 드롭) 기능은 2026-07-15 제거됨 - 룰 이름/
  신원 패턴만으로 너무 거칠게 매칭해서 correlation-engine의 실제 탐지 시나리오(S1/S5/
  S10)가 봐야 할 이벤트까지 같이 드롭하는 게 확인돼, 로그 volume 절감보다 탐지
  누락을 막는 쪽을 택했다(normalizer/app/main.py 모듈 docstring 참고)
- 인시던트 실시간 팝업(P7-1): 전용 엔드포인트 없음 - 프론트가 GET /incidents?since=
  <마지막_확인_시각>을 3~5초 주기로 폴링해서 새 CRITICAL 인시던트를 감지한다
  (2026-07-13 이전엔 WebSocket(/ws/incidents)으로 push했으나 제거됨 - app/incident_alerts.py
  참고).

기동 순서 경쟁: Postgres/ClickHouse/OpenSearch 연결(각각 app/db.py, app/clickhouse_client.py,
app/opensearch_client.py)은 이 서비스가 아직 안 떴을 때 기동하면 실패할 수 있어서
Kafka 컨슈머(normalizer/correlation-engine)와 동일하게 재시도 루프로 감싸져 있다.
/health는 백그라운드 폴링 태스크(_alert_poll_task, _log_retention_task) 중 하나라도
죽었으면 503을 반환한다 - 프로세스는 살아있는데 폴링만 죽어서 Slack/Discord 알림이나
보존기간 집행이 조용히 멈추는 걸 감지하기 위함(servers/docker-compose.yml의
healthcheck가 이 엔드포인트를 주기 폴링).

실행 방법 (컨테이너): servers/docker-compose.yml 포함, 저장소 루트에서 `make up`
(또는 `docker compose -f servers/docker-compose.yml up -d --build`)으로 기동.
"""
import asyncio
import contextlib
from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app import clickhouse_client, db, opensearch_client, pipeline_health_api
from app.ai_report import generate_trend_report, get_cached_trend_report
from app.alert_configs_api import router as alert_configs_router
from app.analytics_api import router as analytics_router
from app.allow_list_api import router as allow_list_router
from app.attck_api import router as attck_router
from app.audit import record_action
from app.audit_logs_api import router as audit_logs_router
from app.auth import current_user_id, router as auth_router, stop as auth_stop, verify_gateway_secret
from app.banned_ips_api import router as banned_ips_router
from app.config import settings
from app.data_policy_api import router_log_policies
from app.events_api import router as events_router
from app.incident_alerts import poll_loop as incident_alerts_poll_loop
from app.incidents_api import router as incidents_router
from app.log_retention import poll_loop as log_retention_poll_loop
from app.trend_report_scheduler import poll_loop as trend_report_scheduler_poll_loop
from app.logs_api import router as logs_router
from app.notifications import notify_text
from app.pipeline_health_api import router as pipeline_health_router
from app.poll_intervals_api import router as poll_intervals_router
from app.report_notification_service import send_report_notification
from app.report_notifications_api import router as report_notifications_router
from app.scenarios_api import router as scenarios_router, stop as scenarios_stop
from app.stats_api import router as stats_router
from app.targets_api import router as targets_router
from app.users_api import router as users_router

app = FastAPI(title="IDS Platform API")

# 프론트엔드가 다른 origin(별도 레포/도메인)에서 호출하므로 CORS를 열어둔다.
# 쿠키 기반 인증이 아니라 로그인 응답의 토큰을 프론트가 직접 들고 다니는 방식이라
# allow_credentials 없이 "*" 허용이어도 안전.
#
# expose_headers에 X-Next-Cursor(app/pagination.py)를 안 넣으면 브라우저가 이걸
# "simple response header"로 안 쳐서(커스텀 헤더는 기본적으로 JS에서 안 보임)
# fetch의 res.headers.get("X-Next-Cursor")가 서버가 실제로 응답에 실어 보내도
# 항상 null로 읽힌다 - 커서 페이지네이션을 쓰는 모든 화면(/incidents, /logs,
# /audit-logs, /events/recent, attck coverage)이 첫 페이지 이상은 못 받아오고
# 조용히 거기서 멈춘다(2026-07-23, IncidentsView Total이 500 초과분부터 안
# 늘어나던 버그의 실제 원인 - 프론트 훅 쪽 페이지네이션 로직 자체는 정상이었음).
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins_list,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Next-Cursor", "X-Next-Since"],
)

# 게이트웨이 시크릿 강제(감사 S13, 2026-07-16) - 모듈 docstring 및
# app/auth.py의 verify_gateway_secret() 참고. siem-net 안에서 Traefik을
# 거치지 않고 이 컨테이너에 직접 붙는 요청을 걸러낸다.
#
# 예외 2개:
#   - OPTIONS: 브라우저 CORS preflight는 커스텀 헤더를 안 실어 보내므로 여기서
#     막으면 실제 요청이 나가기도 전에 죽는다(app/auth.py verify()의 동일 처리 참고).
#   - "/health": 이 컨테이너 자신의 Docker healthcheck(servers/docker-compose.yml)가
#     localhost로 직접 찌르는 경로라 Traefik을 거치지 않는다 - 여기서 막으면
#     healthcheck가 영구 실패해서 컨테이너가 계속 unhealthy로 잡힌다.
#   - "/auth/verify": Traefik forwardAuth의 내부 호출(Traefik이 자체 HTTP
#     클라이언트로 직접 호출) 자체가 라우터/미들웨어 체인을 안 거쳐서 게이트웨이
#     시크릿을 실어줄 방법이 없다 - verify()는 X-Auth-*를 입력으로 신뢰하는
#     게 아니라 세션 토큰으로 직접 판단하므로 이 검증 대상이 아니다.
_GATEWAY_SECRET_EXEMPT_PATHS = {"/health", "/auth/verify"}


class GatewaySecretMiddleware:
    """CORSMiddleware와 같은 순수 ASGI 미들웨어(2026-07-18 수정).

    원래 @app.middleware("http")(Starlette BaseHTTPMiddleware)로 구현돼 있었다.
    BaseHTTPMiddleware는 call_next 이후 로직을 anyio TaskGroup의 별도 task로
    스폰하는 걸로 알려져 있어 구조적으로 피하는 게 맞다(Starlette 자체도 가능하면
    순수 ASGI 미들웨어를 권장 - contextvars 전파, 백그라운드 태스크 등에서 여러
    알려진 문제가 있음) - CORSMiddleware도 같은 이유로 순수 ASGI로 구현돼 있다.

    참고: platform-api 로컬 스모크 테스트(tests/)에서 로그인/CRUD 등 다수
    엔드포인트가 asyncpg "attached to a different loop"/InterfaceError로 실패하는
    별도 이슈가 있는데, 이 미들웨어를 완전히 제거해도 동일하게 재현됨을 확인했다
    (2026-07-18) - 즉 이 미들웨어가 원인이 아니라 tests/conftest.py의 세션 스코프
    event_loop 픽스처 관련 기존 버그다. 이 클래스는 그 문제를 고치지 않는다."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] != "http"
            or scope["method"] == "OPTIONS"
            or scope["path"] in _GATEWAY_SECRET_EXEMPT_PATHS
        ):
            await self.app(scope, receive, send)
            return
        if not verify_gateway_secret(Request(scope, receive)):
            response = JSONResponse(
                status_code=403,
                content={"detail": "missing or invalid internal gateway secret"},
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


app.add_middleware(GatewaySecretMiddleware)


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
app.include_router(events_router)
app.include_router(router_log_policies)
app.include_router(poll_intervals_router)
app.include_router(report_notifications_router)

_alert_poll_task: Optional[asyncio.Task] = None
_log_retention_task: Optional[asyncio.Task] = None
_trend_report_scheduler_task: Optional[asyncio.Task] = None


@app.on_event("startup")
async def on_startup():
    global _alert_poll_task, _log_retention_task, _trend_report_scheduler_task
    await db.start()
    await clickhouse_client.start()
    await opensearch_client.start()
    await pipeline_health_api.start()
    _alert_poll_task = asyncio.create_task(incident_alerts_poll_loop())
    _log_retention_task = asyncio.create_task(log_retention_poll_loop())
    _trend_report_scheduler_task = asyncio.create_task(trend_report_scheduler_poll_loop())


@app.on_event("shutdown")
async def on_shutdown():
    for task in (_alert_poll_task, _log_retention_task, _trend_report_scheduler_task):
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
    await pipeline_health_api.stop()
    await clickhouse_client.stop()
    await db.stop()
    await auth_stop()
    await scenarios_stop()


def _dead_task_reason() -> Optional[str]:
    """백그라운드 폴링 태스크(app/incident_alerts.py, app/log_retention.py)가
    살아있지 않은 이유(있으면) - /health가 503을 반환할지 판단하는 근거. None이면
    정상."""
    if _alert_poll_task is None:
        return "alert poll task not started"
    if _alert_poll_task.done():
        return "alert poll task exited"
    if _log_retention_task is None:
        return "log retention poll task not started"
    if _log_retention_task.done():
        return "log retention poll task exited"
    if _trend_report_scheduler_task is None:
        return "trend report scheduler task not started"
    if _trend_report_scheduler_task.done():
        return "trend report scheduler task exited"
    return None


@app.get("/health")
def health_check():
    reason = _dead_task_reason()
    if reason:
        return JSONResponse(status_code=503, content={"status": "unhealthy", "reason": reason})
    return {"status": "ok"}


@app.get("/reports/trend")
async def trend_report(days: int = 7):
    # 알림 설정 화면을 열 때마다 Gemini를 호출하지 않는다. 스케줄러가 사전 생성한
    # 최신 캐시만 읽고, 다음 예약 시각에 생성될 예정이면 안내만 반환한다.
    return await get_cached_trend_report(days)


_KST = ZoneInfo("Asia/Seoul")


def _client_ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _report_header_timestamp(generated_at_iso: Optional[str]) -> str:
    """report["generated_at"](app/ai_report.py generate_trend_report()의 반환값, 실제
    요약이 생성/캐시된 시각의 UTC ISO 문자열)가 있으면 그 시각을, 없으면(GEMINI_API_KEY
    미설정이나 생성 실패로 통계/안내 텍스트만 있는 경우) 현재 시각을 기준으로 삼는다.
    Slack/Discord 알림은 팀 내부용이라 UTC가 아니라 KST로 표기한다."""
    moment = (
        datetime.fromisoformat(generated_at_iso) if generated_at_iso else datetime.now(timezone.utc)
    )
    return moment.astimezone(_KST).strftime("%Y-%m-%d %H:%M KST")


class TrendReportNotifyIn(BaseModel):
    days: int = 7
    # 'manual'(대시보드에서 직접 리포트 보기/생성) | 'scheduled'(스케줄 배치 자동 생성).
    # 이 엔드포인트는 지금까지 schedule 스킬/CronCreate로 구성한 외부 cron만 호출해왔으므로
    # 기본값이 'scheduled'다 - 그 경우에만 report_notification_service의 Slack/Discord
    # OAuth 연동 발송(sendReportNotification)을 뒤이어 호출한다. GET /reports/trend(대시보드
    # "보기" 경로)는 이 필드 자체가 없고 절대 알림을 보내지 않는다 - generate_trend_report()
    # 자체는 이 구분과 무관하게 그대로 둔다(app/ai_report.py 미변경).
    source: str = "scheduled"


@app.post("/reports/trend/notify")
async def trend_report_notify(body: TrendReportNotifyIn, request: Request):
    """AI 트렌드 리포트(GET /reports/trend와 동일하게 generate_trend_report()에
    위임 - 캐시 로직도 그대로 적용됨)를 생성하고 Slack/Discord 알림 채널로도
    발송한다. GEMINI_API_KEY 미설정 fallback 텍스트(통계 안내문)도 그대로
    발송 대상으로 취급한다 - 별도 스킵 로직을 두지 않는다."""
    report = await generate_trend_report(body.days)
    header = (
        f"📊 AI 트렌드 리포트 (최근 {body.days}일) — "
        f"{_report_header_timestamp(report.get('generated_at'))}"
    )
    text = f"{header}\n{report['message']}"

    # DLQ 적체 알림(app/incident_alerts.py _check_dlq_depth_alerts)과 동일하게
    # severity=3("high") 컨벤션으로 발송 - min_severity<=3인 채널만 받는다.
    # notify_text() 내부의 min_severity 필터/재시도 정책은 그대로 존중한다.
    notify_result = await notify_text(3, text)

    # 신규 Slack/Discord OAuth 연동(P8) 발송 - source가 명시적으로 'scheduled'일 때만.
    # 'manual'로 호출되면(예: 관리자가 "지금 테스트 발송" 없이 그냥 리포트만 다시 보고
    # 싶은 경우) 위 notify_text()의 기존 webhook 알림도, 아래 연동 발송도 건너뛰는 게
    # 맞지만 notify_text는 이 엔드포인트 자체의 기존 계약이라 손대지 않고, 새로 추가하는
    # report_notification_service 발송만 이 분기로 게이팅한다.
    report_notification_result = None
    if body.source == "scheduled":
        report_notification_result = await send_report_notification(report, body.days)

    await record_action(
        "AI_TREND_REPORT_NOTIFIED",
        None,
        _client_ip(request),
        user_id=current_user_id(request),
    )

    return {
        "days": body.days,
        "source": body.source,
        "configured": report["configured"],
        "cached": report["cached"],
        "generated_at": report.get("generated_at"),
        "notify_attempted": notify_result["attempted"],
        "notify_succeeded": notify_result["succeeded"],
        "notify_failed": notify_result["failed"],
        "report_notification": report_notification_result,
    }


class TrendReportGenerateIn(BaseModel):
    days: int = 7


@app.post("/reports/trend/generate")
async def trend_report_generate(body: TrendReportGenerateIn, request: Request):
    """대시보드 "리포트 생성" 버튼 전용 엔드포인트 - generate_trend_report()만
    호출하고 POST /reports/trend/notify와 달리 webhook(notify_text)/OAuth 연동
    알림(send_report_notification)은 보내지 않는다. 관리자가 그냥 최신 리포트를
    지금 바로 보고 싶을 때 쓰는 용도라 알림 채널을 건드릴 이유가 없다."""
    report = await generate_trend_report(body.days)
    await record_action(
        "AI_TREND_REPORT_GENERATED",
        None,
        _client_ip(request),
        user_id=current_user_id(request),
    )
    return {
        "days": body.days,
        "configured": report["configured"],
        "cached": report["cached"],
        "message": report["message"],
        "stats": report["stats"],
        "generated_at": report.get("generated_at"),
    }
