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
