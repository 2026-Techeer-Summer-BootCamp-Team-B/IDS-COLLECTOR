"""Stats API (/stats). 계층별(was/waf/falco/k8s_audit) 통계 집계 - attack-logs-*
인덱스에 대한 terms aggregation (플랫폼 이관)."""
from typing import Any, Dict, Optional

from fastapi import APIRouter

from app.config import settings
from app.opensearch_client import client as opensearch_client

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("")
async def get_stats(start: Optional[str] = None, end: Optional[str] = None) -> Dict[str, Any]:
    query: Dict[str, Any] = {"match_all": {}}
    if start or end:
        time_range: Dict[str, str] = {}
        if start:
            time_range["gte"] = start
        if end:
            time_range["lte"] = end
        query = {"bool": {"filter": [{"range": {"@timestamp": time_range}}]}}

    result = await opensearch_client.search(
        index=settings.attack_log_index_pattern,
        body={
            "size": 0,
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


@router.get("/top-ips")
async def get_top_ips(start: Optional[str] = None, end: Optional[str] = None, limit: int = 10) -> Dict[str, Any]:
    """공격 발원지 IP Top-N — source.ip(attack-logs-* 템플릿에서 type: ip) terms
    aggregation. 프론트 대시보드 Overview의 "Top Sources" 패널이 소비 (원래는
    api-gateway 같은 서비스 이름 기준 mock 집계였는데, 실제 데이터 연동하면서
    "어떤 IP가 제일 많이 찍히는지" 기준으로 의미가 바뀜)."""
    query: Dict[str, Any] = {"match_all": {}}
    if start or end:
        time_range: Dict[str, str] = {}
        if start:
            time_range["gte"] = start
        if end:
            time_range["lte"] = end
        query = {"bool": {"filter": [{"range": {"@timestamp": time_range}}]}}

    result = await opensearch_client.search(
        index=settings.attack_log_index_pattern,
        body={
            "size": 0,
            "query": query,
            "aggs": {"by_ip": {"terms": {"field": "source.ip", "size": min(limit, 50)}}},
        },
    )

    buckets = result["aggregations"]["by_ip"]["buckets"]
    return {"items": [{"source_ip": b["key"], "count": b["doc_count"]} for b in buckets]}
