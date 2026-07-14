"""Stats API (/stats). 계층별(was/waf/falco/k8s_audit) 통계 집계 - attack-logs-*
인덱스에 대한 terms aggregation (플랫폼 이관)."""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter

from app.config import settings
from app.opensearch_client import client as opensearch_client

router = APIRouter(prefix="/stats", tags=["stats"])

# Falco rule.name -> 공격 유형 카테고리. 이 저장소 시나리오 주석(workload.yaml 등)에
# 실제로 나오는 falco 룰 이름 기준 - 가벼운 정적 매핑이라 여기 없는 rule.name은
# "OTHER"로 묶인다(예: 테스트용 더미 룰).
_FALCO_RULE_TO_ATTACK_TYPE = {
    "Terminal shell in container": "SHELL_EXEC",
    "Contact K8s API Server From Container": "C2_COMM",
    "Read sensitive file untrusted": "CRED_ACCESS",
    "Unexpected outbound connection": "C2_COMM",
}

# WAF는 소스 센서가 event.action에 이미 attack_type 문자열을 넣어준다
# (normalizer.py:116) - 매핑은 필요 없고, 실측 데이터에서 같은 뜻인데 스펠링이
# 다른 것만("sqli"/"cmdi"/"lfi" 축약형) 정규 표기로 합친다.
_WAF_ACTION_ALIASES = {
    "sqli": "sql_injection",
    "cmdi": "command_injection",
    "lfi": "local_file_inclusion",
}


def _time_filters(start: Optional[str], end: Optional[str]) -> List[Dict[str, Any]]:
    if not (start or end):
        return []
    time_range: Dict[str, str] = {}
    if start:
        time_range["gte"] = start
    if end:
        time_range["lte"] = end
    return [{"range": {"@timestamp": time_range}}]


def _module_query(module: str, filters: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {"bool": {"filter": [{"term": {"event.module": module}}, *filters]}}


def _time_range_query(start: Optional[str], end: Optional[str]) -> Dict[str, Any]:
    if not (start or end):
        return {"match_all": {}}
    time_range: Dict[str, str] = {}
    if start:
        time_range["gte"] = start
    if end:
        time_range["lte"] = end
    return {"bool": {"filter": [{"range": {"@timestamp": time_range}}]}}


@router.get("")
async def get_stats(start: Optional[str] = None, end: Optional[str] = None) -> Dict[str, Any]:
    filters = _time_filters(start, end)
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


# GET /top-ips는 여기 없다 - app/analytics_api.py(ClickHouse) 참고. 한때 이 파일에도
# OpenSearch terms agg 기반 버전이 같은 경로로 있었는데(2026-07-14 실측 발견),
# main.py가 stats_router를 analytics_router보다 먼저 등록해서 이 파일 버전만 실제로
# 라우팅되고 analytics_api.py의 ClickHouse 버전은 죽은 코드였다 - IP 집계는
# ClickHouse가 맞는 저장소(고카디널리티 컬럼 대상 고속 집계)라 그쪽을 정본으로 남기고
# 이 버전은 지웠다(응답 계약 `{items:[{source_ip,count}]}`는 그대로 유지됨).


async def _window_kpi(start: datetime, end: datetime) -> Dict[str, int]:
    """구간 하나에 대한 total/errors(severity>=3)/warnings(severity==2)/sources(고유
    event.module 수)를 한 번의 요청으로 뽑는다. /kpi가 현재/이전 두 구간에 대해 호출."""
    result = await opensearch_client.search(
        index=settings.attack_log_index_pattern,
        body={
            "size": 0,
            "track_total_hits": True,
            "query": _time_range_query(start.isoformat(), end.isoformat()),
            "aggs": {
                "by_severity": {"terms": {"field": "event.severity", "size": 4}},
                "distinct_modules": {"cardinality": {"field": "event.module"}},
            },
        },
    )
    total = result["hits"]["total"]["value"]
    sev_counts = {b["key"]: b["doc_count"] for b in result["aggregations"]["by_severity"]["buckets"]}
    errors = sum(count for sev, count in sev_counts.items() if sev >= 3)
    warnings = sev_counts.get(2, 0)
    sources = result["aggregations"]["distinct_modules"]["value"]
    return {"total": total, "errors": errors, "warnings": warnings, "sources": sources}


def _pct_delta(current: int, previous: int) -> Optional[float]:
    if previous == 0:
        return None if current == 0 else 100.0
    return round((current - previous) / previous * 100, 1)


@router.get("/kpi")
async def get_kpi(hours: int = 24) -> Dict[str, Any]:
    """Overview 상단 KPI 카드 4개(Total/Errors/Warnings/Active Sources) - 현재
    구간과 바로 직전 동일 길이 구간을 함께 계산해서 델타(%)도 같이 내려준다."""
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
        },
        "sources_delta": current["sources"] - previous["sources"],
    }


@router.get("/volume")
async def get_volume(hours: int = 24, buckets: int = 25, module: Optional[str] = None) -> Dict[str, Any]:
    """Log Volume 차트 - date_histogram으로 시간대별 total/errors(severity>=3)
    카운트. 프론트가 timeSeries.js의 formatBucketLabel로 라벨을 입힌다(버킷 폭
    계산은 여기서, 라벨 포맷은 프론트에서 - RANGE_PRESETS와 동일한 표기 유지).
    module이 주어지면 WAS/Falco/K8s Audit 상세 뷰가 event.module로 필터링해서
    같은 차트를 재사용한다."""
    now = datetime.now(timezone.utc)
    start = now - timedelta(hours=hours)
    interval_seconds = max(int(hours * 3600 / max(buckets, 1)), 60)

    query = _time_range_query(start.isoformat(), now.isoformat())
    if module:
        query = {"bool": {"filter": [{"term": {"event.module": module}}], "must": [query]}}

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
async def get_levels(hours: int = 24, module: Optional[str] = None) -> Dict[str, Any]:
    """Log Levels 차트 - event.severity(1~4) 분포. WAF가 비활성화된 뒤로는
    1~4 정수 스케일이 전부라, 예전 9단계 mock과 달리 그대로 4개 막대로 나간다.
    module이 주어지면 해당 event.module로만 필터링한다."""
    now = datetime.now(timezone.utc)
    start = now - timedelta(hours=hours)

    query = _time_range_query(start.isoformat(), now.isoformat())
    if module:
        query = {"bool": {"filter": [{"term": {"event.module": module}}], "must": [query]}}

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
