"""Logs API (/logs). 정규화 이벤트 조회 - 대상은 attack-logs-* OpenSearch 인덱스
(플랫폼 백엔드로 이관된 조회 전용 API, 색인 자체는 여전히 Data Prepper가 담당)."""
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends

from app.auth import get_current_session
from app.opensearch_client import client as opensearch_client
from app.config import settings

router = APIRouter(prefix="/logs", tags=["logs"], dependencies=[Depends(get_current_session)])


@router.get("")
async def search_logs(
    module: Optional[str] = None,
    min_severity: Optional[int] = None,
    q: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    must: List[Dict[str, Any]] = []
    filters: List[Dict[str, Any]] = []

    if q:
        must.append({"query_string": {"query": q}})
    if module:
        filters.append({"term": {"event.module": module}})
    if min_severity is not None:
        filters.append({"range": {"event.severity": {"gte": min_severity}}})
    if start or end:
        time_range: Dict[str, str] = {}
        if start:
            time_range["gte"] = start
        if end:
            time_range["lte"] = end
        filters.append({"range": {"@timestamp": time_range}})

    query: Dict[str, Any] = {"match_all": {}} if not (must or filters) else {
        "bool": {"must": must, "filter": filters}
    }

    result = await opensearch_client.search(
        index=settings.attack_log_index_pattern,
        body={
            "query": query,
            "sort": [{"@timestamp": {"order": "desc"}}],
            "size": min(limit, 500),
        },
    )
    return [hit["_source"] for hit in result["hits"]["hits"]]
