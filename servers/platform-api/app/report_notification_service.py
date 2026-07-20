"""스케줄 AI 트렌드 리포트(app/ai_report.py generate_trend_report())를 Slack Block Kit/
Discord Embed로 변환해 사용자별 연동 채널(app/report_notifications_api.py의
report_notification_connections)로 발송한다.

app/notifications.py(alert_configs 기반 텍스트 웹훅, 인시던트 실시간 알림 전용)와는
완전히 별개 경로다 - 이쪽은 OAuth 연동 채널(access_token + channel_id, 계정별) 전용이고
스케줄 리포트(app/main.py의 POST /reports/trend/notify, source='scheduled'일 때만)만
호출한다.

# TODO: 실제 OAuth 연동 시 교체가 필요한 지점 (Slack/Discord 앱 등록 완료 후)
#   1. send_to_slack() - 아래 mock 대신 Slack Web API chat.postMessage 호출
#   2. send_to_discord() - 아래 mock 대신 Discord Bot API 또는 Incoming Webhook 호출
#   (연동 자체의 OAuth 코드 교환 목업은 dashboard/src/lib/reportIntegrationsMock.js 참고 -
#   그쪽은 프론트 전용이고 여기 두 함수는 서버가 실제로 메시지를 보내는 지점이다)
"""
import asyncio
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from app.config import settings
from app.crypto_utils import decrypt_token
from app.db import pool

_MAX_FIELD_SCENARIOS = 5

# Slack은 *bold*/_italic_ mrkdwn을, 리포트 원문(app/ai_report.py _SYSTEM_PROMPT)은
# 표준 마크다운(**bold**/*italic*/## heading)을 쓴다 - Block Kit section 텍스트에
# 그대로 넣으면 별표가 안 풀리고 그대로 노출되므로 최소한으로 맞춰준다. Discord Embed는
# **bold**/*italic*을 표준 마크다운 그대로 지원하지만 ## 헤딩은 렌더링하지 않으므로
# 헤딩만 굵게 바꿔준다 - _to_discord_text()가 별도로 처리.
def _to_slack_mrkdwn(text: str) -> str:
    lines = []
    for line in text.split("\n"):
        stripped = line.lstrip("#").strip() if line.lstrip().startswith("#") else line
        stripped = stripped.replace("**", "*")
        lines.append(stripped)
    return "\n".join(lines)


def _to_discord_text(text: str) -> str:
    lines = []
    for line in text.split("\n"):
        if line.lstrip().startswith("#"):
            lines.append(f"**{line.lstrip('#').strip()}**")
        else:
            lines.append(line)
    return "\n".join(lines)


def _dashboard_url() -> str:
    return settings.dashboard_base_url


def _top_scenarios(stats: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return stats[:_MAX_FIELD_SCENARIOS]


def _max_severity(stats: List[Dict[str, Any]]) -> int:
    return max((s.get("max_severity") or 0 for s in stats), default=0)


def build_slack_blocks(report: Dict[str, Any], days: int) -> List[Dict[str, Any]]:
    """Slack Block Kit blocks: 헤더 + 요약 섹션 + 주요 시나리오 필드 + 대시보드 버튼."""
    stats = report.get("stats") or []
    blocks: List[Dict[str, Any]] = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": f"📊 AI 트렌드 리포트 (최근 {days}일)"},
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": _to_slack_mrkdwn(report["message"])},
        },
    ]

    top = _top_scenarios(stats)
    if top:
        blocks.append(
            {
                "type": "section",
                "fields": [
                    {
                        "type": "mrkdwn",
                        "text": f"*{s.get('scenario_name') or '미매칭'}*\n{s['incident_count']}건 · severity≥{s['max_severity']}",
                    }
                    for s in top
                ],
            }
        )

    blocks.append(
        {
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "대시보드에서 보기"},
                    "url": _dashboard_url(),
                    "action_id": "view_dashboard",
                }
            ],
        }
    )
    return blocks


def build_discord_embed(report: Dict[str, Any], days: int) -> Dict[str, Any]:
    """Discord Embed: 제목/설명/색상 바/필드/타임스탬프 + 대시보드 링크."""
    stats = report.get("stats") or []
    max_sev = _max_severity(stats)
    color = 0xE01E5A if max_sev >= 3 else 0x2EB67D  # 심각도 3 이상이면 경고색, 아니면 안내색

    generated_at = report.get("generated_at")
    timestamp = generated_at if generated_at else datetime.now(timezone.utc).isoformat()

    return {
        "title": f"📊 AI 트렌드 리포트 (최근 {days}일)",
        "description": _to_discord_text(report["message"]),
        "color": color,
        "url": _dashboard_url(),
        "fields": [
            {
                "name": s.get("scenario_name") or "미매칭",
                "value": f"{s['incident_count']}건 · severity≥{s['max_severity']}",
                "inline": True,
            }
            for s in _top_scenarios(stats)
        ],
        "timestamp": timestamp,
    }


async def send_to_slack(access_token: str, channel_id: str, blocks: List[Dict[str, Any]]) -> Dict[str, Any]:
    # TODO: 실제 연동 시 아래 mock 대신 Slack Web API
    # (https://slack.com/api/chat.postMessage) 호출로 교체:
    #   POST https://slack.com/api/chat.postMessage
    #   Authorization: Bearer {access_token}
    #   json={"channel": channel_id, "blocks": blocks}
    print(f"[MOCK] Slack 전송: {json.dumps({'channelId': channel_id, 'blocks': blocks}, ensure_ascii=False)}")
    return {"success": True, "mocked": True}


async def send_to_discord(access_token: str, channel_id: str, embed: Dict[str, Any]) -> Dict[str, Any]:
    # TODO: 실제 연동 시 아래 mock 대신 Discord Bot API
    # (https://discord.com/api/v10/channels/{channel_id}/messages, Authorization: Bot {token})
    # 또는 Incoming Webhook(https://discord.com/api/webhooks/{id}/{token}) 호출로 교체
    print(f"[MOCK] Discord 전송: {json.dumps({'channelId': channel_id, 'embed': embed}, ensure_ascii=False)}")
    return {"success": True, "mocked": True}


async def _record_history(
    connection_id: UUID,
    platform: str,
    channel_id: str,
    status: str,
    mocked: bool,
    error_message: Optional[str] = None,
) -> None:
    async with pool().acquire() as conn:
        await conn.execute(
            """
            INSERT INTO report_notification_history
                (connection_id, platform, channel_id, status, mocked, error_message)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            connection_id,
            platform,
            channel_id,
            status,
            mocked,
            error_message,
    )
async def _send_for_connection(row: Any, report: Dict[str, Any], days: int) -> Dict[str, Any]:
    """연동 하나에 대한 발송 - 예외를 여기서 전부 삼켜서 send_report_notification()의
    asyncio.gather가 다른 연동에 영향을 주지 않는다(Promise.allSettled와 동일한 의도)."""
    platform = row["platform"]
    channel_id = row["channel_id"]
    try:
        access_token = decrypt_token(row["access_token_encrypted"])
        if platform == "slack":
            result = await send_to_slack(access_token, channel_id, build_slack_blocks(report, days))
        else:
            result = await send_to_discord(access_token, channel_id, build_discord_embed(report, days))
        await _record_history(row["id"], platform, channel_id, "success", result.get("mocked", True))
        return {"platform": platform, "channel_id": channel_id, "status": "success"}
    except Exception as e:  # noqa: BLE001 - 발송 실패 사유를 이력에 그대로 남겨야 함
        await _record_history(row["id"], platform, channel_id, "failed", True, error_message=str(e))
        return {"platform": platform, "channel_id": channel_id, "status": "failed", "error": str(e)}


async def send_report_notification(report: Dict[str, Any], days: int = 7) -> Dict[str, Any]:
    """활성화된 연동(Slack/Discord, 계정 무관 전체) 각각에 독립적으로 발송한다 - 하나가
    실패해도 asyncio.gather(return_exceptions=True)로 나머지에 영향을 주지 않는다."""
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, platform, access_token_encrypted, channel_id
            FROM report_notification_connections
            WHERE enabled
            """
        )

    if not rows:
        return {"attempted": 0, "succeeded": 0, "failed": 0, "results": []}

    results = await asyncio.gather(*(_send_for_connection(r, report, days) for r in rows), return_exceptions=True)

    summary = {"attempted": len(results), "succeeded": 0, "failed": 0, "results": []}
    for r in results:
        if isinstance(r, Exception):
            summary["failed"] += 1
            summary["results"].append({"status": "failed", "error": str(r)})
        else:
            summary["results"].append(r)
            summary["succeeded" if r["status"] == "success" else "failed"] += 1
    return summary
