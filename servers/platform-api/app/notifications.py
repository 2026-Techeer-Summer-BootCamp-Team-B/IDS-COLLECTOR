"""알림 채널 (P5-3): Slack/Discord 웹훅 + CRITICAL 즉시 푸시.
구 즉시대응경로의 후신 - 여기서는 알림만 보내고 실제 차단은 하지 않는다."""
from typing import Any, Dict

import httpx

from app.config import settings


async def _post_webhook(url: str, payload: Dict[str, Any]) -> None:
    if not url:
        return
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            await client.post(url, json=payload)
        except httpx.HTTPError as e:
            print(f"[platform-api] 웹훅 전송 실패: {e}")


async def notify_incident(incident: Dict[str, Any]) -> None:
    if incident.get("severity", 0) < settings.critical_severity_threshold:
        return

    text = (
        f":rotating_light: CRITICAL 인시던트 - {incident.get('title')} "
        f"(correlation_key={incident.get('correlation_key_value')}, severity={incident.get('severity')})"
    )
    await _post_webhook(settings.slack_webhook_url, {"text": text})
    await _post_webhook(settings.discord_webhook_url, {"content": text})
