"""Webhook 채널별 AI 트렌드 리포트 일일 스케줄러(KST)."""
import asyncio
import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.ai_report import generate_trend_report
from app.db import pool
from app.notifications import _post_webhook

_KST = ZoneInfo("Asia/Seoul")
_POLL_SECONDS = 30
_PREPARE_SECONDS = 3 * 60
_prepared_reports = {}
_preparing_slots = set()


def _schedule_items(row):
    value = row["trend_report_schedule"]
    return json.loads(value) if isinstance(value, str) else (value or [])


def _slot_candidates(rows, now):
    """현재 시각 기준 3분 이내에 생성해야 할 예약 슬롯을 중복 없이 반환한다."""
    candidates = {}
    for row in rows:
        sent_slots = row["trend_report_sent_slots"]
        sent_slots = json.loads(sent_slots) if isinstance(sent_slots, str) else (sent_slots or {})
        for item in _schedule_items(row):
            try:
                hour, minute = (int(part) for part in item.get("time", "").split(":", 1))
            except (AttributeError, ValueError):
                continue
            for day_offset in (0, 1):
                target_date = now.date() + timedelta(days=day_offset)
                target = datetime(
                    target_date.year, target_date.month, target_date.day,
                    hour, minute, tzinfo=_KST,
                )
                seconds_until = (target - now).total_seconds()
                if target.weekday() in (item.get("days") or []) and 0 < seconds_until <= _PREPARE_SECONDS:
                    key = f"{target_date}:{hour:02d}:{minute:02d}"
                    if key in sent_slots:
                        continue
                    candidates[key] = (target_date, f"{hour:02d}:{minute:02d}")
    return candidates


async def _prepare_reports(rows, now):
    for slot_key, (target_date, time_value) in _slot_candidates(rows, now).items():
        if slot_key in _prepared_reports or slot_key in _preparing_slots:
            continue
        _preparing_slots.add(slot_key)
        try:
            # 채널 수와 무관하게 같은 예약 슬롯에서는 Gemini를 한 번만 호출한다.
            _prepared_reports[slot_key] = await generate_trend_report(7)
            print(f"[platform-api] AI 리포트 사전 생성 완료: {target_date} {time_value}")
        finally:
            _preparing_slots.discard(slot_key)


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

    await _prepare_reports(rows, now)
            
    due_rows = [
        row for row in rows
        if any(item.get("time") == time_value and weekday in item.get("days", []) for item in _schedule_items(row))
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

    slot_key = f"{today}:{time_value}"
    try:
        # 3분 전에 준비한 결과를 사용한다. API가 그 사이 재시작된 경우에만 안전하게
        # 즉시 생성해 발송을 놓치지 않도록 fallback한다.
        report = _prepared_reports.pop(slot_key, None) or await generate_trend_report(7)
        text = (
            f"📅 {today}  ⏰ {time_value}\n"
            f"📊 인시던트 트렌드 요약 리포트 (최근 7일)\n\n"
            f"{report['message']}"
        )
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
