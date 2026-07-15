"""알림 채널 (P5-3): Slack/Discord 웹훅.
구 즉시대응경로의 후신 - 여기서는 알림만 보내고 실제 차단은 하지 않는다.

alert_configs 테이블(app/alert_configs_api.py로 CRUD)을 조회해서 enabled=true고
incident의 severity가 그 채널의 min_severity 이상인 행에만 발송한다 - 예전엔
.env 고정 웹훅 URL 1개씩(SLACK_WEBHOOK_URL/DISCORD_WEBHOOK_URL)만 봤는데, 이제
런타임에 여러 채널을 등록/토글할 수 있는 테이블 쪽으로 옮겼다."""
import asyncio
from typing import Any, Callable, Dict, List

import httpx

from app.db import pool

_PAYLOAD_BUILDERS: Dict[str, Callable[[str], Dict[str, Any]]] = {
    "slack": lambda text: {"text": text},
    "discord": lambda text: {"content": text},
}

# app/alert_configs_api.py가 channel_type을 저장할 때 이 집합으로 검증한다 - 예전엔
# 여기서만(발송 시점에) _PAYLOAD_BUILDERS.get()이 None이면 조용히 return해서, 오타난
# channel_type("slcak" 등)으로 등록해도 API가 200을 반환하고 그 채널은 영원히
# 알림을 못 받으면서도 화면상 "Active"로 남아있었다(2026-07-15).
SUPPORTED_CHANNEL_TYPES = frozenset(_PAYLOAD_BUILDERS)

_MAX_ATTEMPTS = 3
_BACKOFF_BASE_SECONDS = 1.0  # 1s -> 2s -> 4s


async def _post_webhook(channel_type: str, url: str, text: str) -> None:
    """웹훅 POST - 연결 실패/타임아웃/4xx·5xx(레이트리밋 429 포함) 전부 지수
    백오프로 최대 _MAX_ATTEMPTS번까지 재시도한다. 예전엔 실패를 로그만 찍고
    그 자리에서 포기해서 일시적 네트워크 장애면 그 알림이 그냥 유실됐다
    (2026-07-14). raise_for_status()가 없으면 httpx가 4xx/5xx를 예외로 안 던져서
    (webhook URL이 잘못됐거나 레이트리밋에 걸려도) "성공"으로 착각하는 별도
    버그도 같이 있었음 - 여기서 같이 고침.

    notify_incident()(incident_alerts.py의 poll_loop)는 인시던트당 한 번만 이
    함수를 부르고 바로 notified_at을 찍으므로, 여기서 마지막 시도까지 실패하면
    그 인시던트에 대한 이 채널 알림은 정말로 유실된다(같은 인시던트가 재발화해
    다시 notify_incident가 불릴 때까지는 재시도 기회가 없음) - 무한 재시도는
    poll_loop 전체를 오래 막을 수 있어서 하지 않는다."""
    build_payload = _PAYLOAD_BUILDERS.get(channel_type)
    if not url or build_payload is None:
        return

    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.post(url, json=build_payload(text))
                response.raise_for_status()
            return
        except httpx.HTTPError as e:
            if attempt == _MAX_ATTEMPTS:
                print(
                    f"[platform-api] 웹훅 전송 실패({channel_type}), "
                    f"{attempt}회 재시도 끝에 포기: {e}"
                )
                return
            backoff = _BACKOFF_BASE_SECONDS * (2 ** (attempt - 1))
            print(
                f"[platform-api] 웹훅 전송 실패({channel_type}), "
                f"{backoff:.0f}s 후 재시도({attempt}/{_MAX_ATTEMPTS}): {e}"
            )
            await asyncio.sleep(backoff)


async def _matching_alert_configs(severity: int) -> List[Any]:
    async with pool().acquire() as conn:
        return await conn.fetch(
            "SELECT channel_type, webhook_url FROM alert_configs "
            "WHERE enabled AND min_severity <= $1",
            severity,
        )


async def notify_incident(incident: Dict[str, Any]) -> None:
    severity = incident.get("severity", 0)
    rows = await _matching_alert_configs(severity)
    if not rows:
        return

    text = (
        f":rotating_light: 인시던트 - {incident.get('title')} "
        f"(correlation_key={incident.get('correlation_key_value')}, severity={severity})"
    )
    for row in rows:
        await _post_webhook(row["channel_type"], row["webhook_url"], text)
