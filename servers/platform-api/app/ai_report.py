"""AI 트렌드 리포트 (P5-4): Gemini API 주기 요약 리포트.

API 키가 없으면 통계만 반환하고 "미설정"으로 안내한다. 주기 실행(cron)은
schedule 스킬/CronCreate로 별도 구성."""
import json
from typing import Any, Dict, List

from google import genai
from google.genai import errors, types

from app.config import settings
from app.db import pool

_SYSTEM_PROMPT = """당신은 사내 보안 운영팀(SOC)을 위해 상관분석 인시던트 트렌드를 요약하는 보안 분석가입니다.
입력으로 주어지는 시나리오별 인시던트 집계 통계만 근거로 삼아 다음 내용을 포함한 간결한 한국어 요약을 작성하세요:

1. 가장 많이 발생한 시나리오 Top 3와 그 특징
2. 심각도(1=낮음 ~ 4=치명적) 관점에서 주목할 점 - 특히 max_severity가 3 이상인 시나리오
3. 데이터에서 드러나는 눈에 띄는 패턴이나 이상 징후
4. 팀이 다음으로 취해야 할 실행 가능한 권고 사항 2~3가지

형식 규칙:
- 주어진 통계에 없는 사실을 추측하거나 지어내지 마세요.
- 통계가 비어 있으면 다른 내용 없이 "최근 N일간 발생한 인시던트가 없습니다."라고만 답하세요.
- 마크다운 소제목과 불릿을 사용해 6~10문장 분량으로 간결하게 작성하세요.
- 어투는 팀 내부 리포트에 적합한 격식체(합쇼체)로 작성하세요."""


async def _gather_stats(days: int) -> List[Dict[str, Any]]:
    """incidents.scenario_id는 존재하지 않는 컬럼이다(실제 컬럼명은
    matched_scenario_rule_id, 001-schema.sql 참고) - 이 쿼리가 그 이름으로 조회해서
    /reports/trend가 호출될 때마다 500이 나던 버그였다."""
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                i.matched_scenario_rule_id AS scenario_id,
                sr.name AS scenario_name,
                count(*) AS incident_count,
                max(i.severity) AS max_severity
            FROM incidents i
            LEFT JOIN scenario_rules sr ON sr.id = i.matched_scenario_rule_id
            WHERE i.created_at >= now() - ($1 || ' days')::interval
            GROUP BY i.matched_scenario_rule_id, sr.name
            ORDER BY incident_count DESC
            LIMIT 20
            """,
            str(days),
        )
    return [dict(r) for r in rows]


def _build_user_prompt(days: int, stats: List[Dict[str, Any]]) -> str:
    return (
        f"다음은 최근 {days}일간 발생한 보안 인시던트를 상관분석 시나리오별로 집계한 "
        "데이터입니다 (JSON):\n\n"
        f"{json.dumps(stats, ensure_ascii=False, indent=2, default=str)}\n\n"
        "각 필드 설명: scenario_name(매칭된 상관분석 시나리오 이름, null이면 미매칭), "
        "incident_count(해당 시나리오로 발생한 인시던트 수), "
        "max_severity(해당 시나리오에서 관측된 최고 심각도).\n\n"
        "위 데이터를 바탕으로 보안 담당자를 위한 요약 리포트를 작성하세요."
    )


async def generate_trend_report(days: int = 7) -> Dict[str, Any]:
    stats = await _gather_stats(days)

    if not settings.gemini_api_key:
        return {
            "configured": False,
            "message": "GEMINI_API_KEY 미설정 - 원본 통계만 반환",
            "stats": stats,
        }

    client = genai.Client(api_key=settings.gemini_api_key)
    try:
        response = await client.aio.models.generate_content(
            model=settings.gemini_model,
            contents=_build_user_prompt(days, stats),
            config=types.GenerateContentConfig(
                system_instruction=_SYSTEM_PROMPT,
                max_output_tokens=1024,
            ),
        )
    except errors.APIError as e:
        return {
            "configured": True,
            "message": f"AI 요약 생성 실패: {e.message}",
            "stats": stats,
        }

    if not response.text:
        return {
            "configured": True,
            "message": "AI 요약 생성 실패 (안전 필터에 의해 차단되었거나 응답이 비어 있음)",
            "stats": stats,
        }

    # 프론트(dashboard/src/views/AdminAuditView.jsx TrendReportPanel)가 message를
    # 그대로 렌더링하는 게 기존 계약이라, 요약 완료 시에도 message에 담아 돌려준다.
    return {
        "configured": True,
        "message": response.text,
        "stats": stats,
    }
