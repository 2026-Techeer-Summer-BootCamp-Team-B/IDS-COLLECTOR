"""Webhook 채널별 AI 트렌드 리포트 일일 스케줄러(KST)."""
import asyncio
import json
from datetime import datetime
from zoneinfo import ZoneInfo

from app.ai_report import generate_trend_report
from app.db import pool
from app.notifications import _post_webhook

_KST = ZoneInfo("Asia/Seoul")
_POLL_SECONDS = 30


async def _run_due_reports() -> None:
    now = datetime.now(_KST)
    time_value = now.strftime("%H:%M")
    weekday = now.weekday()
    today = now.date()
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, channel_type, webhook_url, trend_report_schedule, trend_report_sent_slots FROM alert_configs
            WHERE enabled AND receive_trend_report
            """,
        )
            
    due_rows = [
        row for row in rows
        if any(item.get("time") == time_value and weekday in item.get("days", []) for item in (json.loads(row["trend_report_schedule"]) if isinstance(row["trend_report_schedule"], str) else row["trend_report_schedule"]))
        and (json.loads(row["trend_report_sent_slots"]) if isinstance(row["trend_report_sent_slots"], str) else row["trend_report_sent_slots"]).get(f"{today}:{time_value}") is None
    ]
    if not due_rows:
        return

    # 발송 완료 표시를 웹훅 호출 뒤에 남기면, 같은 분에 스케줄러가 두 번 실행되거나
    # API 인스턴스가 겹칠 때 두 실행이 모두 웹훅을 보낼 수 있다. 조건부 UPDATE로
    # 먼저 슬롯을 선점해 한 인스턴스만 발송하게 한다.
    slot_key = f"{today}:{time_value}"
    claimed_rows = []
    async with pool().acquire() as conn:
        for row in due_rows:
            claimed = await conn.fetchrow(
                """
                UPDATE alert_configs
                SET trend_report_sent_slots = COALESCE(trend_report_sent_slots, '{}'::jsonb)
                    || jsonb_build_object($2, true), updated_at = now()
                WHERE id = $1
                  AND enabled AND receive_trend_report
                  AND COALESCE(trend_report_sent_slots, '{}'::jsonb) ->> $2 IS NULL
                RETURNING id, channel_type, webhook_url
                """,
                row["id"],
                slot_key,
            )
            if claimed:
                claimed_rows.append(claimed)

    if not claimed_rows:
        return

    try:
        report = await generate_trend_report(7)
        text = f"📊 AI 트렌드 리포트 (최근 7일)\n{report['message']}"
    except Exception:
        # 리포트 생성 실패 시에는 선점을 되돌려 다음 폴링에서 재시도할 수 있게 한다.
        async with pool().acquire() as conn:
            for row in claimed_rows:
                await conn.execute(
                    "UPDATE alert_configs SET trend_report_sent_slots = COALESCE(trend_report_sent_slots, '{}'::jsonb) - $2, updated_at = now() WHERE id = $1",
                    row["id"],
                    slot_key,
                )
        raise

    for row in claimed_rows:
        if await _post_webhook(row["channel_type"], row["webhook_url"], text):
            async with pool().acquire() as conn:
                await conn.execute(
                    "UPDATE alert_configs SET trend_report_last_sent_date = $2, updated_at = now() WHERE id = $1",
                    row["id"],
                    today,
                )
        else:
            # 웹훅 실패는 발송된 것으로 처리하지 않고 다음 폴링에서 재시도한다.
            async with pool().acquire() as conn:
                await conn.execute(
                    "UPDATE alert_configs SET trend_report_sent_slots = COALESCE(trend_report_sent_slots, '{}'::jsonb) - $2, updated_at = now() WHERE id = $1",
                    row["id"],
                    slot_key,
                )


async def poll_loop() -> None:
    while True:
        try:
            await _run_due_reports()
        except Exception as exc:  # noqa: BLE001 - 다음 폴링을 계속한다.
            print(f"[platform-api] AI 리포트 스케줄러 오류: {exc}")
        await asyncio.sleep(_POLL_SECONDS)
