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


async def _post_webhook(channel_type: str, url: str, text: str) -> bool:
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
    poll_loop 전체를 오래 막을 수 있어서 하지 않는다.

    반환값(성공 여부)은 notify_text()가 호출별 성공/실패 채널 수를 집계하는 데
    쓴다 - 재시도 정책 자체는 바뀌지 않는다."""
    build_payload = _PAYLOAD_BUILDERS.get(channel_type)
    if not url or build_payload is None:
        return False

    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.post(url, json=build_payload(text))
                response.raise_for_status()
            return True
        except httpx.HTTPError as e:
            if attempt == _MAX_ATTEMPTS:
                print(
                    f"[platform-api] 웹훅 전송 실패({channel_type}), "
                    f"{attempt}회 재시도 끝에 포기: {e}"
                )
                return False
            backoff = _BACKOFF_BASE_SECONDS * (2 ** (attempt - 1))
            print(
                f"[platform-api] 웹훅 전송 실패({channel_type}), "
                f"{backoff:.0f}s 후 재시도({attempt}/{_MAX_ATTEMPTS}): {e}"
            )
            await asyncio.sleep(backoff)
    return False


async def _matching_alert_configs(severity: int) -> List[Any]:
    async with pool().acquire() as conn:
        return await conn.fetch(
            "SELECT channel_type, webhook_url FROM alert_configs "
            "WHERE enabled AND receive_incidents AND min_severity <= $1",
            severity,
        )


async def notify_text(severity: int, text: str) -> Dict[str, int]:
    """severity 이상을 구독하는 채널 전부에 임의 텍스트를 발송 - notify_incident()와
    DLQ 깊이 알림(app/incident_alerts.py, 2026-07-16)이 공유하는 발송 경로.
    인시던트 형태로 안 맞는 운영 알림(파이프라인 적체 등)도 같은 채널/쿨다운 없는
    즉시발송 정책을 타게 하려고 텍스트만 받는 형태로 분리했다.

    반환값(attempted/succeeded/failed 채널 수)은 리포트 웹훅 트리거(app/main.py의
    POST /reports/trend/notify)처럼 호출 결과를 응답에 담아야 하는 호출부를 위한
    것 - notify_incident()/DLQ 알림처럼 결과를 안 쓰는 기존 호출부는 그냥 무시하면
    되므로(반환값 추가는 하위호환) 동작이 바뀌지 않는다."""
    rows = await _matching_alert_configs(severity)
    result = {"attempted": 0, "succeeded": 0, "failed": 0}
    for row in rows:
        result["attempted"] += 1
        ok = await _post_webhook(row["channel_type"], row["webhook_url"], text)
        if ok:
            result["succeeded"] += 1
        else:
            result["failed"] += 1
    return result


async def notify_incident(incident: Dict[str, Any]) -> None:
    severity = incident.get("severity", 0)
    text = (
        f":rotating_light: 인시던트 - {incident.get('title')} "
        f"(correlation_key={incident.get('correlation_key_value')}, severity={severity})"
    )
    await notify_text(severity, text)
