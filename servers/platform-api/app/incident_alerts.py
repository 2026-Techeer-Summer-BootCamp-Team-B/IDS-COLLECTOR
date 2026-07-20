"""인시던트 발화 시 Slack/Discord 알림(P5-3) 트리거 + DLQ/unknown 적체 알림(2026-07-16).

예전엔 correlation-engine이 발화 즉시 Redis pub/sub(incidents:events)로 push하고
여기서 구독해 WebSocket 릴레이 + 알림을 같이 쐈는데, platform-api가 재시작/단절된
사이에 발화된 인시던트는 pub/sub 특성상 알림이 영구 유실되는 문제가 있었다.

2026-07-13부로 push를 걷어내고 incidents.notified_at(010 마이그레이션) 컬럼을 보고
"아직 알림 안 보낸 행"만 주기 폴링해서 보내는 방식으로 바꿨다 - 재시작해도
notified_at IS NULL인 행이 다음 폴링에 그대로 잡히므로 유실이 없다. 대신 최대 폴링
주기만큼 알림이 지연된다. 프론트엔드 실시간 팝업도 같은 이유로 WebSocket
(/ws/incidents)에서 GET /incidents?since= 폴링으로 대체됐다(app/incidents_api.py
참고) - 이제 이 파일이 여는 WebSocket 엔드포인트는 없다.

폴링 주기는 더 이상 settings.alert_poll_interval_seconds(env var, 바꾸려면 재시작
필요) 고정값이 아니라 poll_intervals 테이블(014-poll-intervals.sql, GET/PATCH
/poll-intervals API)에서 매 반복마다 다시 읽는다(2026-07-15) - admin이 API로
바꾸면 재시작 없이 다음 반복부터 바로 반영된다.

DLQ/unknown 깊이 알림(2026-07-16, docs/reports/repo-audit-20260715.md O11/§3.3):
events.dlq·events.unknown은 자동 소비자가 없어(계약상 "수동 점검" 대상) 적체돼도
아무도 모르고 지나가다 7일 retention(2026-07-16 연장분)이 지나면 원본이 그냥
사라졌다 - 같은 폴링 루프에서 깊이가 "직전 체크 대비 증가"했는지만 보고, 늘었으면
쿨다운(기본 30분)을 두고 기존 알림 채널(app/notifications.py)로 발송한다. 깊이
계산은 app/pipeline_health_api.py의 get_topic_depth()(원래 /stats/dlq-depth·
/stats/unknown-depth가 쓰던 것)를 그대로 재사용 - 로직을 새로 안 만든다."""
import asyncio
import time
from typing import Dict

from app.db import pool
from app.notifications import notify_incident, notify_text
from app.pipeline_health_api import DLQ_TOPIC, UNKNOWN_TOPIC, get_topic_depth

_POLL_LIMIT = 100
_DEFAULT_INTERVAL_SECONDS = 5  # poll_intervals 행이 없는 극단적 상황(마이그레이션
# 누락 등)에 대비한 fail-open 기본값 - 이전 하드코딩 기본값과 동일하게 맞췄다.

_DLQ_ALERT_TOPICS = (DLQ_TOPIC, UNKNOWN_TOPIC)
_DLQ_ALERT_COOLDOWN_SECONDS = 30 * 60  # 알림 폭탄 방지 - 토픽당 최근 30분 내
# 발송 이력이 있으면 깊이가 계속 늘어도 스킵한다(기본값, 상수라 재배포 시에만 조절
# 가능 - poll_intervals처럼 런타임 조절 가능한 설정으로 승격할 정도로 자주 바꿀
# 값은 아니라고 판단).
_DLQ_ALERT_SEVERITY = 3  # 공격 지표는 아니지만 이벤트 유실 위험이라 "high"(심각도
# 매핑 시트 기준)로 발송 - alert_configs.min_severity<=3인 채널이 받는다.
_DLQ_ALERT_FAILURE_LOG_THRESHOLD = 3  # 이 횟수 연속 실패하면 ERROR로 승격해서
# 남긴다 - 그 이하는 poll_loop의 기존 "다음 주기 재시도" 로그와 같은 수준으로만
# 남겨서, O5(예외 삼키고 좀비화)를 새 코드에서 반복하지 않으면서도 로그를 도배하지
# 않는다.

_dlq_last_depth: Dict[str, int] = {}
_dlq_last_alert_at: Dict[str, float] = {}
_dlq_alert_consecutive_failures = 0


async def _current_interval_seconds() -> float:
    async with pool().acquire() as conn:
        value = await conn.fetchval(
            "SELECT seconds FROM poll_intervals WHERE key = 'alert_poll_interval_seconds'"
        )
    return value if value is not None else _DEFAULT_INTERVAL_SECONDS


async def _dispatch_pending() -> None:
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, title, correlation_key_type, correlation_key_value, severity
            FROM incidents WHERE notified_at IS NULL
            ORDER BY created_at ASC LIMIT $1
            """,
            _POLL_LIMIT,
        )
        if not rows:
            return

        # notified_at은 각 행을 보내자마자 그 자리에서 찍는다 - 예전엔 배치 전체를
        # 다 보낸 뒤 한 번에 UPDATE ... = ANY(...)로 묶어서 찍었는데, notify_incident()
        # 내부의 _matching_alert_configs()(Postgres 조회)가 배치 중간 행에서 예외를
        # 던지면(일시적 DB 커넥션 장애 등 - _post_webhook 자체는 재시도 후 항상
        # 정상 반환하므로 여기서만 터질 수 있음) 그 배치 전체의 UPDATE가 안 돌아서,
        # 이미 Slack/Discord로 성공적으로 보낸 앞쪽 행들까지 notified_at이 NULL로
        # 남아 다음 폴링에서 중복 발송됐다(2026-07-15 실측 확인 후 수정). 행 단위로
        # 찍으면 실패 시점 이전 행은 중복 발송되지 않고, 이후 행만 자연스럽게
        # notified_at IS NULL로 남아 다음 폴링에서 정상 재시도된다.
        for row in rows:
            await notify_incident(dict(row))
            await conn.execute(
                "UPDATE incidents SET notified_at = now() WHERE id = $1",
                row["id"],
            )


async def _check_dlq_depth_alerts() -> None:
    """events.dlq/events.unknown 깊이가 직전 체크 대비 늘었으면(=적체 진행 중)
    쿨다운을 두고 알림을 보낸다. 이 함수는 스스로 예외를 삼키고 절대 밖으로
    던지지 않는다 - poll_loop()의 기존 예외 처리(O5가 지적한, 예외를 삼키고
    계속 도는 패턴)를 건드리지 않으면서도, 이 함수 자체가 O5와 같은 방식으로
    "조용히 좀비화"하지 않도록 연속 실패 횟수를 추적해 임계치를 넘으면 ERROR로
    승격해 로그를 남긴다."""
    global _dlq_alert_consecutive_failures
    try:
        now = time.monotonic()
        for topic in _DLQ_ALERT_TOPICS:
            depth = await get_topic_depth(topic)
            previous = _dlq_last_depth.get(topic)
            _dlq_last_depth[topic] = depth
            if previous is None or depth <= previous:
                continue  # 최초 관측이거나 늘지 않았으면 알릴 것 없음

            last_alert = _dlq_last_alert_at.get(topic)
            if last_alert is not None and (now - last_alert) < _DLQ_ALERT_COOLDOWN_SECONDS:
                continue  # 쿨다운 중 - 알림 폭탄 방지

            await notify_text(
                _DLQ_ALERT_SEVERITY,
                f":warning: {topic} 적체 증가 - {previous} -> {depth}건 "
                f"(자동 소비자 없음, 수동 점검 필요)",
            )
            _dlq_last_alert_at[topic] = now
        _dlq_alert_consecutive_failures = 0
    except Exception as e:
        _dlq_alert_consecutive_failures += 1
        if _dlq_alert_consecutive_failures >= _DLQ_ALERT_FAILURE_LOG_THRESHOLD:
            print(
                f"[platform-api] ERROR: DLQ 깊이 확인이 {_dlq_alert_consecutive_failures}회 "
                f"연속 실패 - {e}"
            )
        else:
            print(f"[platform-api] DLQ 깊이 확인 실패, 다음 주기에 재시도: {e}")


async def poll_loop() -> None:
    # 2026-07-15 버그 수정: _current_interval_seconds() 호출이 try/except 밖에
    # 있어서 (예: poll_intervals 테이블이 아직 없는 배포 직후처럼) 여기서 예외가
    # 나면 잡히지 않고 while 루프 전체가 죽었다 - 그러면 이 태스크가
    # done()이 되고, /health가 영구 503을 반환하고, Traefik이 platform-api
    # 라우팅 자체를 내려버려서 로그인을 포함한 모든 /api/*가 대시보드 정적
    # 서버로 새서 405가 나는 사고로 이어졌다(실측 확인, 2026-07-15). 폴링 주기
    # 조회도 같은 try/except 안으로 넣어서, 실패해도 기본 간격으로 다음
    # 주기에 재시도하도록 고쳤다.
    while True:
        interval: float = _DEFAULT_INTERVAL_SECONDS
        try:
            await _dispatch_pending()
            await _check_dlq_depth_alerts()  # 자체적으로 예외를 삼키므로 이 try에 걸리지 않음
            interval = await _current_interval_seconds()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[platform-api] 인시던트 알림 폴링 실패, 다음 주기에 재시도: {e}")
        await asyncio.sleep(interval)
