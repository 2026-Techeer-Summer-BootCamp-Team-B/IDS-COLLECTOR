"""알림 채널 (P5-3): Slack/Discord 웹훅.
구 즉시대응경로의 후신 - 여기서는 알림만 보내고 실제 차단은 하지 않는다.

alert_configs 테이블(app/alert_configs_api.py로 CRUD)을 조회해서 enabled=true고
incident의 severity가 그 채널의 min_severity 이상인 행에만 발송한다 - 예전엔
.env 고정 웹훅 URL 1개씩(SLACK_WEBHOOK_URL/DISCORD_WEBHOOK_URL)만 봤는데, 이제
런타임에 여러 채널을 등록/토글할 수 있는 테이블 쪽으로 옮겼다."""
from typing import Any, Callable, Dict, List

import httpx

from app.db import pool

_PAYLOAD_BUILDERS: Dict[str, Callable[[str], Dict[str, Any]]] = {
    "slack": lambda text: {"text": text},
    "discord": lambda text: {"content": text},
}


async def _post_webhook(channel_type: str, url: str, text: str) -> None:
    build_payload = _PAYLOAD_BUILDERS.get(channel_type)
    if not url or build_payload is None:
        return
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            await client.post(url, json=build_payload(text))
        except httpx.HTTPError as e:
            print(f"[platform-api] 웹훅 전송 실패({channel_type}): {e}")


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
