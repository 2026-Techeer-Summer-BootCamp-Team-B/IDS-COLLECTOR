"""Stats API (/stats). module/severity 관련 통계는 대부분 ClickHouse로 이관됐고
(app/analytics_api.py 참고), 이 파일엔 진짜 OpenSearch가 맞는 것만 남는다:
- /source-health: 모듈별 "마지막으로 언제 들어왔나" 단발 lookup(범위 스캔 없음)
- /kpi: Total/Errors/Warnings/Active Sources는 ClickHouse(app/analytics_api.py의
  get_kpi_windows)로 계산하고, Blocked(waf.blocked=true)만 이 파일에 남아
  가벼운 filter agg 하나로 OpenSearch에 묻는다 - security_events_analytics
  테이블에 waf.blocked 컬럼이 없어서(화이트리스트된 컬럼만 저장) 이 값만은
  ClickHouse로 옮길 수 없다(2026-07-24, "Overview KPI가 너무 느리다" 피드백으로
  실측 확인 - 예전엔 이 하나의 엔드포인트가 현재+이전 구간 두 번, 매번 severity
  terms + module cardinality + blocked filter까지 agg 3개를 attack-logs-*
  와일드카드 전체에 대해 2초 폴링마다 돌리고 있었다)."""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter

from app.analytics_api import get_kpi_windows as _clickhouse_kpi_windows
from app.config import settings
from app.opensearch_client import client as opensearch_client

router = APIRouter(prefix="/stats", tags=["stats"])

# 소스 헬스체크(absent_over_time류 - 이 소스가 조용해졌는가) 대상 event.module 목록과
# 임계치. dashboard/src/views/InfrastructureView.jsx의 SourceHealthPanel이 예전엔
# dashboard/src/data/attackEvents.js의 sourceHealth()로 흉내만 냈다(고정 mock
# 날짜 기준이라 실제 파이프라인 상태와 무관하게 항상 같은 값이 나옴, 2026-07-15
# 확인) - 여기서 attack-logs-*의 실제 최신 문서 시각으로 대체한다. waf는
# 2026-07-16에 백엔드가 다시 붙으면서(moduleMeta.js 참고) 실제로 이벤트가
# 들어오게 됐으므로 모니터링 대상에 포함한다.
_HEALTH_MODULES = ["was", "waf", "falco", "k8s_audit"]
_HEALTH_WARNING_SECONDS = 30 * 60
_HEALTH_CRITICAL_SECONDS = 2 * 60 * 60


def _health_status(silent_seconds: Optional[float]) -> str:
    if silent_seconds is None or silent_seconds >= _HEALTH_CRITICAL_SECONDS:
        return "critical"
    if silent_seconds >= _HEALTH_WARNING_SECONDS:
        return "warning"
    return "healthy"


def _time_range_query(start: Optional[str], end: Optional[str]) -> Dict[str, Any]:
    if not (start or end):
        return {"match_all": {}}
    time_range: Dict[str, str] = {}
    if start:
        time_range["gte"] = start
    if end:
        time_range["lte"] = end
    return {"bool": {"filter": [{"range": {"@timestamp": time_range}}]}}


# GET /stats(root, by_module/by_severity)는 여기 없다 - app/analytics_api.py
# (ClickHouse) 참고. 2026-07-24, "탐지 소스별 분포/모듈 상세뷰 Total 카드가
# 느리다" 피드백으로 실측 확인 - attack-logs-* 와일드카드에 대한 module+severity
# terms agg를 4개 화면(Overview + WAS/WAF/Falco/K8s Audit 상세)이 각자 2초
# 폴링마다, 90일 프리셋까지 걸어서 호출하고 있었다. 응답 계약은 그대로 유지.


@router.get("/source-health")
async def get_source_health() -> List[Dict[str, Any]]:
    """모니터링 대상 소스(_HEALTH_MODULES)별 최신 attack-logs-* 문서 시각과
    무응답 경과 시간 - terms agg로 한 번에 묶고 max agg로 모듈별 최신
    @timestamp만 뽑는다(top_hits로 문서 전체를 끌어올 필요 없음). 한 번도
    수신한 적 없는 모듈은 agg 버킷 자체에 안 잡히므로(문서가 0건이면 bucket이
    안 생김) last_seen=None, status="critical"로 채워서 응답한다."""
    result = await opensearch_client.search(
        index=settings.attack_log_index_pattern,
        body={
            "size": 0,
            "query": {"terms": {"event.module": _HEALTH_MODULES}},
            "aggs": {
                "by_module": {
                    "terms": {"field": "event.module", "size": len(_HEALTH_MODULES)},
                    "aggs": {"last_seen": {"max": {"field": "@timestamp"}}},
                }
            },
        },
    )

    last_seen_ms: Dict[str, Optional[float]] = {module: None for module in _HEALTH_MODULES}
    for bucket in result["aggregations"]["by_module"]["buckets"]:
        value = bucket["last_seen"]["value"]
        if value is not None:
            last_seen_ms[bucket["key"]] = value

    now_ms = datetime.now(timezone.utc).timestamp() * 1000
    health = []
    for module in _HEALTH_MODULES:
        seen_ms = last_seen_ms[module]
        silent_seconds = None if seen_ms is None else (now_ms - seen_ms) / 1000
        health.append(
            {
                "module": module,
                "last_seen": datetime.fromtimestamp(seen_ms / 1000, tz=timezone.utc).isoformat()
                if seen_ms is not None
                else None,
                "silent_seconds": silent_seconds,
                "status": _health_status(silent_seconds),
            }
        )
    return health


# GET /top-ips는 여기 없다 - app/analytics_api.py(ClickHouse) 참고. 한때 이 파일에도
# OpenSearch terms agg 기반 버전이 같은 경로로 있었는데(2026-07-14 실측 발견),
# main.py가 stats_router를 analytics_router보다 먼저 등록해서 이 파일 버전만 실제로
# 라우팅되고 analytics_api.py의 ClickHouse 버전은 죽은 코드였다 - IP 집계는
# ClickHouse가 맞는 저장소(고카디널리티 컬럼 대상 고속 집계)라 그쪽을 정본으로 남기고
# 이 버전은 지웠다(응답 계약 `{items:[{source_ip,count}]}`는 그대로 유지됨).


async def _window_blocked(start: datetime, end: datetime) -> int:
    """WAF가 실제로 막은(waf.blocked=true) 요청 건수(모듈 전체가 아니라 "차단까지
    된" 것만 - 탐지만 되고 통과된 요청은 제외, 2026-07-16 "총 BLOCKED가 뭘
    뜻하는지" 피드백으로 정의). Total/Errors/Warnings/Active Sources는
    app/analytics_api.py의 get_kpi_windows()가 ClickHouse로 계산하는데, 이
    값만은 security_events_analytics 테이블에 waf.blocked 컬럼이 없어서(화이트
    리스트된 컬럼만 저장) 여기서 OpenSearch에 filter agg 하나로 가볍게
    묻는다(2026-07-24, 예전엔 이것도 severity terms/module cardinality와
    한 요청에 같이 껴서 훨씬 무거웠다)."""
    result = await opensearch_client.search(
        index=settings.attack_log_index_pattern,
        body={
            "size": 0,
            "query": _time_range_query(start.isoformat(), end.isoformat()),
            "aggs": {"blocked": {"filter": {"term": {"waf.blocked": True}}}},
        },
    )
    return result["aggregations"]["blocked"]["doc_count"]


def _pct_delta(current: int, previous: int) -> Optional[float]:
    # 2026-07-16: previous==0인데 current>0이면 예전엔 "100.0"을 고정으로
    # 돌려줬는데, 이건 실제 증감률이 아니라 0으로 못 나누니까 대충 끼워맞춘
    # 숫자였다 - 데모에서 "왜 맨날 정확히 100%야?"로 바로 티가 났다(피드백).
    # 수학적으로 정의가 안 되는 구간(이전 구간에 비교할 데이터 자체가 없음)이니
    # 억지로 숫자를 만들지 않고 None(=프론트에서 배지 자체를 안 보여줌)으로
    # 돌린다 - "비교할 이전 데이터 없음"을 정직하게 표현.
    if previous == 0:
        return None
    return round((current - previous) / previous * 100, 1)


@router.get("/kpi")
async def get_kpi(hours: float = 24) -> Dict[str, Any]:
    """Overview 상단 KPI 카드(Total/Errors/Warnings/Active Sources/Blocked) - 현재
    구간과 바로 직전 동일 길이 구간을 함께 계산해서 델타(%)도 같이 내려준다.
    Total/Errors/Warnings/Active Sources는 ClickHouse(get_kpi_windows), Blocked만
    OpenSearch(_window_blocked) - 위 두 함수 docstring 참고.

    hours가 int면 1시간 미만 RANGE_PRESETS(1분/5분/15분/30분)에서 422가 난다 -
    /stats/volume과 동일한 이유로 float (2026-07-14)."""
    now = datetime.now(timezone.utc)
    current_start = now - timedelta(hours=hours)
    previous_start = current_start - timedelta(hours=hours)

    ch_current, ch_previous = await _clickhouse_kpi_windows(current_start, now, previous_start, current_start)
    blocked_current = await _window_blocked(current_start, now)
    blocked_previous = await _window_blocked(previous_start, current_start)

    current = {**ch_current, "blocked": blocked_current}
    previous = {**ch_previous, "blocked": blocked_previous}

    return {
        "current": current,
        "previous": previous,
        "delta_pct": {
            "total": _pct_delta(current["total"], previous["total"]),
            "errors": _pct_delta(current["errors"], previous["errors"]),
            "warnings": _pct_delta(current["warnings"], previous["warnings"]),
            "blocked": _pct_delta(current["blocked"], previous["blocked"]),
        },
        "sources_delta": current["sources"] - previous["sources"],
    }


# GET /volume, GET /levels는 여기 없다 - app/analytics_api.py(ClickHouse) 참고.
# 한때 이 파일에 OpenSearch date_histogram/terms agg 기반으로 있었는데
# (2026-07-24 "심각도 분포/Log Volume이 너무 느리다" 피드백으로 실측 확인),
# attack-logs-* 와일드카드 인덱스를 시간 상한 없이(대시보드 90일 프리셋까지)
# 폴링마다(2~5초 주기) 매번 재집계하고 있었다 - /stats/top-ips와 같은 이유로
# ClickHouse가 맞는 저장소(시계열 컬럼형 집계용 MergeTree, PARTITION BY
# toDate(timestamp))라 그쪽을 정본으로 옮겼다(응답 계약은 그대로 유지 -
# dashboard/src/hooks/useLogVolume.js·useLogLevels.js 변경 불필요).
