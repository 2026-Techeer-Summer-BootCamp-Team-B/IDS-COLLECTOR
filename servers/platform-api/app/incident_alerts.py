"""인시던트 발화 시 Slack/Discord 알림(P5-3) 트리거.

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
필요) 고정값이 아니라 poll_intervals 테이블(013-poll-intervals.sql, GET/PATCH
/poll-intervals API)에서 매 반복마다 다시 읽는다(2026-07-15) - admin이 API로
바꾸면 재시작 없이 다음 반복부터 바로 반영된다."""
import asyncio

from app.db import pool
from app.notifications import notify_incident

_POLL_LIMIT = 100
_DEFAULT_INTERVAL_SECONDS = 5  # poll_intervals 행이 없는 극단적 상황(마이그레이션
# 누락 등)에 대비한 fail-open 기본값 - 이전 하드코딩 기본값과 동일하게 맞췄다.


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

        for row in rows:
            await notify_incident(dict(row))

        await conn.execute(
            "UPDATE incidents SET notified_at = now() WHERE id = ANY($1::uuid[])",
            [row["id"] for row in rows],
        )


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
        interval = _DEFAULT_INTERVAL_SECONDS
        try:
            await _dispatch_pending()
            interval = await _current_interval_seconds()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[platform-api] 인시던트 알림 폴링 실패, 다음 주기에 재시도: {e}")
        await asyncio.sleep(interval)
