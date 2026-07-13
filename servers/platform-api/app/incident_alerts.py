"""인시던트 발화 시 Slack/Discord 알림(P5-3) 트리거.

예전엔 correlation-engine이 발화 즉시 Redis pub/sub(incidents:events)로 push하고
여기서 구독해 WebSocket 릴레이 + 알림을 같이 쐈는데, platform-api가 재시작/단절된
사이에 발화된 인시던트는 pub/sub 특성상 알림이 영구 유실되는 문제가 있었다.

2026-07-13부로 push를 걷어내고 incidents.notified_at(010 마이그레이션) 컬럼을 보고
"아직 알림 안 보낸 행"만 주기 폴링(settings.alert_poll_interval_seconds)해서 보내는
방식으로 바꿨다 - 재시작해도 notified_at IS NULL인 행이 다음 폴링에 그대로 잡히므로
유실이 없다. 대신 최대 폴링 주기만큼 알림이 지연된다. 프론트엔드 실시간 팝업도 같은
이유로 WebSocket(/ws/incidents)에서 GET /incidents?since= 폴링으로 대체됐다
(app/incidents_api.py 참고) - 이제 이 파일이 여는 WebSocket 엔드포인트는 없다."""
import asyncio

from app.config import settings
from app.db import pool
from app.notifications import notify_incident

_POLL_LIMIT = 100


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
    while True:
        try:
            await _dispatch_pending()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[platform-api] 인시던트 알림 폴링 실패, 다음 주기에 재시도: {e}")
        await asyncio.sleep(settings.alert_poll_interval_seconds)
