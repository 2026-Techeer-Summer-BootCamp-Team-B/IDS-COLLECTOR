"""Stats API (/stats). 계층별(was/waf/falco/k8s_audit) 통계 집계 - attack-logs-*
인덱스에 대한 terms aggregation (플랫폼 이관)."""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter

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


def _time_filters(start: Optional[str], end: Optional[str]) -> List[Dict[str, Any]]:
    if not (start or end):
        return []
    time_range: Dict[str, str] = {}
    if start:
        time_range["gte"] = start
    if end:
        time_range["lte"] = end
    return [{"range": {"@timestamp": time_range}}]


def _time_range_query(start: Optional[str], end: Optional[str]) -> Dict[str, Any]:
    if not (start or end):
        return {"match_all": {}}
    time_range: Dict[str, str] = {}
    if start:
        time_range["gte"] = start
    if end:
        time_range["lte"] = end
    return {"bool": {"filter": [{"range": {"@timestamp": time_range}}]}}


def _severity_filters(min_severity: Optional[int], severity: Optional[int]) -> List[Dict[str, Any]]:
    """Overview KPI 카드(Total/Errors/Warnings) 클릭 필터를 /stats류 집계
    엔드포인트에도 그대로 적용하기 위한 공용 헬퍼. severity(정확히 일치, WARNING
    전용)가 있으면 그걸 우선하고, 없으면 min_severity(">=", ERROR 전용)를 쓴다.
    (dashboard/src/views/LogDashboard.jsx의 KPI_MIN_SEVERITY와 짝 - ALL은 둘 다
    None이라 필터 없음.)"""
    if severity is not None:
        return [{"term": {"event.severity": severity}}]
    if min_severity is not None:
        return [{"range": {"event.severity": {"gte": min_severity}}}]
    return []


@router.get("")
async def get_stats(
    start: Optional[str] = None,
    end: Optional[str] = None,
    min_severity: Optional[int] = None,
    severity: Optional[int] = None,
) -> Dict[str, Any]:
    filters = _time_filters(start, end) + _severity_filters(min_severity, severity)
    query: Dict[str, Any] = {"match_all": {}} if not filters else {"bool": {"filter": filters}}

    result = await opensearch_client.search(
        index=settings.attack_log_index_pattern,
        body={
            "size": 0,
            "track_total_hits": True,
            "query": query,
            "aggs": {
                "by_module": {"terms": {"field": "event.module", "size": 10}},
                "by_severity": {"terms": {"field": "event.severity", "size": 4}},
            },
        },
    )

    aggs = result["aggregations"]
    return {
        "total": result["hits"]["total"]["value"],
        "by_module": [
            {"module": b["key"], "count": b["doc_count"]} for b in aggs["by_module"]["buckets"]
        ],
        "by_severity": [
            {"severity": b["key"], "count": b["doc_count"]} for b in aggs["by_severity"]["buckets"]
        ],
    }


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


async def _window_kpi(start: datetime, end: datetime) -> Dict[str, int]:
    """구간 하나에 대한 total/errors(severity>=3)/warnings(severity==2)/sources(고유
    event.module 수)/blocked(waf.blocked=true 건수)를 한 번의 요청으로 뽑는다.
    /kpi가 현재/이전 두 구간에 대해 호출. blocked는 2026-07-16 "총 BLOCKED가
    뭘 뜻하는지" 피드백으로 추가 - WAF가 실제로 막은(waf.blocked=true) 요청
    건수로 정의했다(모듈 전체가 아니라 "차단까지 된" 것만 센다 - 탐지만 되고
    통과된 요청은 포함 안 함)."""
    result = await opensearch_client.search(
        index=settings.attack_log_index_pattern,
        body={
            "size": 0,
            "track_total_hits": True,
            "query": _time_range_query(start.isoformat(), end.isoformat()),
            "aggs": {
                "by_severity": {"terms": {"field": "event.severity", "size": 4}},
                "distinct_modules": {"cardinality": {"field": "event.module"}},
                "blocked": {"filter": {"term": {"waf.blocked": True}}},
            },
        },
    )
    total = result["hits"]["total"]["value"]
    sev_counts = {b["key"]: b["doc_count"] for b in result["aggregations"]["by_severity"]["buckets"]}
    errors = sum(count for sev, count in sev_counts.items() if sev >= 3)
    warnings = sev_counts.get(2, 0)
    sources = result["aggregations"]["distinct_modules"]["value"]
    blocked = result["aggregations"]["blocked"]["doc_count"]
    return {"total": total, "errors": errors, "warnings": warnings, "sources": sources, "blocked": blocked}


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

    hours가 int면 1시간 미만 RANGE_PRESETS(1분/5분/15분/30분)에서 422가 난다 -
    /stats/volume과 동일한 이유로 float (2026-07-14)."""
    now = datetime.now(timezone.utc)
    current_start = now - timedelta(hours=hours)
    previous_start = current_start - timedelta(hours=hours)

    current = await _window_kpi(current_start, now)
    previous = await _window_kpi(previous_start, current_start)

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


@router.get("/volume")
async def get_volume(
    hours: float = 24,
    buckets: int = 25,
    module: Optional[str] = None,
    min_severity: Optional[int] = None,
    severity: Optional[int] = None,
) -> Dict[str, Any]:
    """Log Volume 차트 - date_histogram으로 시간대별 total/errors(severity>=3)
    카운트. 프론트가 timeSeries.js의 formatBucketLabel로 라벨을 입힌다(버킷 폭
    계산은 여기서, 라벨 포맷은 프론트에서 - RANGE_PRESETS와 동일한 표기 유지).
    module이 주어지면 WAS/Falco/K8s Audit 상세 뷰가 event.module로 필터링해서
    같은 차트를 재사용한다. min_severity/severity는 Overview KPI 카드
    (Errors/Warnings) 클릭 필터 - 2026-07-17, "KPI 눌러도 차트가 안 바뀐다" 피드백으로
    추가(_severity_filters 참고).

    hours는 int가 아니라 float이어야 한다 - 프론트 RANGE_PRESETS의 1분/5분/15분/30분
    같은 1시간 미만 구간은 lookbackMs/3600000이 정수가 아니라서(예: 1분=0.0167)
    int로 받으면 422(Input should be a valid integer)로 거부당한다(2026-07-14,
    "Last 1 minute" 선택 시 Log Volume이 안 뜨던 원인 - 실측 확인)."""
    now = datetime.now(timezone.utc)
    start = now - timedelta(hours=hours)
    interval_seconds = max(int(hours * 3600 / max(buckets, 1)), 60)

    filters = [{"term": {"event.module": module}}] if module else []
    filters += _severity_filters(min_severity, severity)
    query = _time_range_query(start.isoformat(), now.isoformat())
    if filters:
        query = {"bool": {"filter": filters, "must": [query]}}

    result = await opensearch_client.search(
        index=settings.attack_log_index_pattern,
        body={
            "size": 0,
            "query": query,
            "aggs": {
                "over_time": {
                    "date_histogram": {
                        "field": "@timestamp",
                        "fixed_interval": f"{interval_seconds}s",
                        "min_doc_count": 0,
                        "extended_bounds": {"min": int(start.timestamp() * 1000), "max": int(now.timestamp() * 1000)},
                    },
                    "aggs": {"errors": {"filter": {"range": {"event.severity": {"gte": 3}}}}},
                }
            },
        },
    )

    return {
        "bucket_ms": interval_seconds * 1000,
        "buckets": [
            {"ts": b["key"], "total": b["doc_count"], "errors": b["errors"]["doc_count"]}
            for b in result["aggregations"]["over_time"]["buckets"]
        ],
    }


@router.get("/levels")
async def get_levels(
    hours: float = 24,
    module: Optional[str] = None,
    min_severity: Optional[int] = None,
    severity: Optional[int] = None,
) -> Dict[str, Any]:
    """Log Levels 차트 - event.severity(1~4) 분포. WAF가 비활성화된 뒤로는
    1~4 정수 스케일이 전부라, 예전 9단계 mock과 달리 그대로 4개 막대로 나간다.
    module이 주어지면 해당 event.module로만 필터링한다. min_severity/severity는
    Overview KPI 카드 클릭 필터(_severity_filters 참고, 2026-07-17 추가) - Errors를
    누르면 Major~Critical만, Warnings를 누르면 Minor만 남기고 나머지 막대는 0건으로
    보여서 "지금 무슨 조건으로 좁혀봤는지"가 막대 자체로도 드러난다.

    hours는 float (2026-07-14, /stats/kpi·/stats/volume과 동일 이유)."""
    now = datetime.now(timezone.utc)
    start = now - timedelta(hours=hours)

    filters = [{"term": {"event.module": module}}] if module else []
    filters += _severity_filters(min_severity, severity)
    query = _time_range_query(start.isoformat(), now.isoformat())
    if filters:
        query = {"bool": {"filter": filters, "must": [query]}}

    result = await opensearch_client.search(
        index=settings.attack_log_index_pattern,
        body={
            "size": 0,
            "track_total_hits": True,
            "query": query,
            "aggs": {"by_severity": {"terms": {"field": "event.severity", "size": 4}}},
        },
    )

    return {
        "total": result["hits"]["total"]["value"],
        "levels": [
            {"severity": b["key"], "count": b["doc_count"]}
            for b in result["aggregations"]["by_severity"]["buckets"]
        ],
    }
