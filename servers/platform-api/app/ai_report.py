"""AI 트렌드 리포트 (P5-4): Gemini API 주기 요약 리포트.

API 키가 없으면 통계만 반환하고 "미설정"으로 안내한다. 주기 실행(cron)은
schedule 스킬/CronCreate로 별도 구성.

같은 days 창의 집계(stats)가 지난 호출과 완전히 동일하면(=그 사이 새 인시던트가
없었음) Gemini를 다시 호출하지 않고 ai_trend_report_cache(019 마이그레이션)에
저장해둔 이전 요약을 그대로 돌려준다 - 같은 입력을 다시 넣어봐야 같은 결론만
나오니 토큰 낭비다."""
import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from google import genai
from google.genai import errors, types

from app.config import settings
from app.db import pool

_SYSTEM_PROMPT = """당신은 사내 보안 운영팀(SOC)을 위해 상관분석 인시던트 트렌드를 요약하는 보안 분석가입니다.
입력으로 주어지는 시나리오별 인시던트 집계 통계만 근거로 삼아 다음 내용을 포함한 간결한 한국어 요약을 작성하세요:

1. 🔎 가장 많이 발생한 시나리오 Top 3와 그 특징
2. 🚨 심각도(1=낮음 ~ 4=치명적) 관점에서 주목할 점 - 특히 max_severity가 3 이상인 시나리오
3. 📈 데이터에서 드러나는 눈에 띄는 패턴이나 이상 징후
4. 🛡️ 팀이 다음으로 취해야 할 실행 가능한 권고 사항 2~3가지

형식 규칙:
- 주어진 통계에 없는 사실을 추측하거나 지어내지 마세요.
- 통계가 비어 있으면 다른 내용 없이 "최근 N일간 발생한 인시던트가 없습니다."라고만 답하세요.
- 소제목은 반드시 ## 마크다운 헤딩으로만 쓰고, 불릿은 -로 쓰세요. 6~10문장 분량으로 간결하게
  작성하세요.
- 각 소제목과 핵심 불릿 앞에는 🔎 🚨 📈 🛡️ ✅ ⚠️ 같은 의미가 분명한 이모지를 적극적으로 사용하세요.
- 어투는 팀 내부 리포트에 적합한 격식체(합쇼체)로 작성하세요.
- **볼드**는 "어떤 위협을 몇 건 방어/탐지했다"는 핵심 사실에만 씁니다 - 시나리오/위협
  이름과 그 건수를 함께 볼드로 감싸세요 (예: "**SQL Injection 175건** 차단",
  "**Pod Exec 권한 사용 이후 컨테이너 내 이상행동 36건**"). 숫자만 따로 감싸지 말고
  위협 이름까지 포함해서 감싸세요.
- *이탤릭*(별표 하나)은 "4. 실행 가능한 권고 사항" 각 항목의 핵심 조치 문구에 씁니다
  (예: "*RBAC 정책을 재검토*하고 불필요한 권한을 제거하십시오" - 조치 동사구만
  감싸고 부연 설명은 감싸지 않음). 볼드/이탤릭 둘 다 소제목이나 일반 설명 문장
  전체를 감싸는 데는 절대 쓰지 마세요 - 프론트엔드가 볼드는 빨간색, 이탤릭은
  파란색으로 렌더링해 "이미 관측된 위협/건수"와 "지금 취해야 할 조치"를 색으로
  구분하는 용도라, 지정된 곳 외에 쓰면 화면이 지저분해집니다."""


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


def _stats_hash(stats: List[Dict[str, Any]]) -> str:
    canonical = json.dumps(stats, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def _get_cached_message(days: int, stats_hash: str) -> Optional[Dict[str, Any]]:
    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            "SELECT message, generated_at FROM ai_trend_report_cache WHERE days = $1 AND stats_hash = $2",
            days,
            stats_hash,
        )
    return dict(row) if row else None


async def _get_latest_cached_message(days: int) -> Optional[Dict[str, Any]]:
    """현재 통계와 무관하게 마지막으로 생성된 리포트를 읽는다.

    대시보드 조회는 예약 발송을 위한 사전 생성 상태를 설명하는 화면이 아니라,
    운영자가 가장 최근 분석 결과를 확인하는 화면이다. 따라서 새 인시던트가 생겨
    stats_hash가 달라졌더라도 마지막 성공 리포트는 계속 보여준다.
    """
    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            "SELECT message, generated_at FROM ai_trend_report_cache WHERE days = $1",
            days,
        )
    return dict(row) if row else None


async def _save_cache(days: int, stats_hash: str, message: str, generated_at: datetime) -> None:
    async with pool().acquire() as conn:
        await conn.execute(
            """
            INSERT INTO ai_trend_report_cache (days, stats_hash, message, generated_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (days) DO UPDATE
            SET stats_hash = EXCLUDED.stats_hash, message = EXCLUDED.message, generated_at = EXCLUDED.generated_at
            """,
            days,
            stats_hash,
            message,
            generated_at,
        )


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


async def generate_trend_report(days: int = 7, *, occurred_at: Optional[datetime] = None) -> Dict[str, Any]:
    """반환 딕셔너리의 generated_at은 실제 요약이 생성/캐시된 시각(UTC ISO 문자열)이고,
    GEMINI_API_KEY 미설정이나 생성 실패처럼 실제 생성 시각이 없는 경우 None이다 -
    호출부(app/main.py의 POST /reports/trend/notify)가 그런 경우 자체적으로 "현재 시각"을
    채워 넣는다.

    occurred_at은 trend_report_scheduler.py의 예약 슬롯 사전생성(_prepare_reports)
    전용 - 슬롯 3분 전에 실제로 Gemini 호출이 끝난 시각이 아니라, 그 리포트가
    "몇 시 슬롯을 위한 것인지"(예약 시각)를 generated_at으로 남기기 위함이다.
    자정(00:00) 슬롯처럼 사전생성이 전날로 넘어가는 경우, 이걸 안 넘기면
    대시보드에 리포트 날짜가 하루 전으로 잘못 표시된다. 수동 생성(버튼)은 항상
    None으로 호출해 실제 생성 시각을 그대로 쓴다."""
    stats = await _gather_stats(days)

    if not settings.gemini_api_key:
        return {
            "configured": False,
            "message": "GEMINI_API_KEY 미설정 - 원본 통계만 반환",
            "stats": stats,
            "cached": False,
            "generated_at": None,
        }

    stats_hash = _stats_hash(stats)
    cached = await _get_cached_message(days, stats_hash)
    if cached is not None:
        return {
            "configured": True,
            "message": cached["message"],
            "stats": stats,
            "cached": True,
            "generated_at": cached["generated_at"].isoformat(),
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
        # 실패는 캐시하지 않는다 - 다음 호출이 재시도할 수 있어야 하고, 기존에
        # 저장된 성공 캐시가 있었다면 그걸 실패로 덮어써서 잃어버리면 안 된다.
        return {
            "configured": True,
            "message": f"AI 요약 생성 실패: {e.message}",
            "stats": stats,
            "cached": False,
            "generated_at": None,
        }

    if not response.text:
        return {
            "configured": True,
            "message": "AI 요약 생성 실패 (안전 필터에 의해 차단되었거나 응답이 비어 있음)",
            "stats": stats,
            "cached": False,
            "generated_at": None,
        }

    generated_at = occurred_at or datetime.now(timezone.utc)
    await _save_cache(days, stats_hash, response.text, generated_at)

    # 프론트(dashboard/src/views/AdminAuditView.jsx TrendReportPanel)가 message를
    # 그대로 렌더링하는 게 기존 계약이라, 요약 완료 시에도 message에 담아 돌려준다.
    return {
        "configured": True,
        "message": response.text,
        "stats": stats,
        "cached": False,
        "generated_at": generated_at.isoformat(),
    }


async def get_cached_trend_report(days: int = 7) -> Dict[str, Any]:
    """대시보드 조회용 캐시 읽기 경로.

    알림 설정 화면을 열 때 Gemini를 새로 호출하지 않고, 마지막으로 생성된
    리포트를 반환한다.
    """
    stats = await _gather_stats(days)
    if not settings.gemini_api_key:
        return {
            "configured": False,
            "message": "⚙️ GEMINI_API_KEY 미설정 - 예약 시각에 원본 통계만 발송됩니다.",
            "stats": stats,
            "cached": False,
            "generated_at": None,
        }
    cached = await _get_latest_cached_message(days)
    if cached is None:
        return {
            "configured": True,
            "message": "아직 생성된 AI 인시던트 트렌드 리포트가 없습니다.",
            "stats": stats,
            "cached": False,
            "generated_at": None,
        }
    return {
        "configured": True,
        "message": cached["message"],
        "stats": stats,
        "cached": True,
        "generated_at": cached["generated_at"].isoformat(),
    }
