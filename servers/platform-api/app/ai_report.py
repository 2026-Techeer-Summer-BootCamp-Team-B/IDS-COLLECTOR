"""AI 트렌드 리포트 (P5-4): Anthropic API 주기 요약 리포트.

API 키가 없으면 통계만 반환하고 "미설정"으로 안내한다 - 실제 프롬프트 구성과
주기 실행(cron)은 팀 설계 후 채울 것 (schedule 스킬/CronCreate로 주기화하면 된다)."""
from typing import Any, Dict, List

from app.config import settings
from app.db import pool


async def _gather_stats(days: int) -> List[Dict[str, Any]]:
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT scenario_id, count(*) AS incident_count, max(severity) AS max_severity
            FROM incidents
            WHERE created_at >= now() - ($1 || ' days')::interval
            GROUP BY scenario_id
            ORDER BY incident_count DESC
            """,
            str(days),
        )
    return [dict(r) for r in rows]


async def generate_trend_report(days: int = 7) -> Dict[str, Any]:
    stats = await _gather_stats(days)

    if not settings.anthropic_api_key:
        return {
            "configured": False,
            "message": "ANTHROPIC_API_KEY 미설정 - 원본 통계만 반환",
            "stats": stats,
        }

    # TODO: anthropic 패키지의 client.messages.create로 stats를 요약해서 리포트
    # 텍스트를 생성. 프롬프트 내용과 실행 주기는 팀 설계 후 결정.
    return {
        "configured": True,
        "message": "TODO: Anthropic API 호출 구현 필요",
        "stats": stats,
    }
