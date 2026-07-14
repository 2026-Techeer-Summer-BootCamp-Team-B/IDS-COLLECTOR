"""Logs API (/logs). 정규화 이벤트 조회 - 대상은 attack-logs-* OpenSearch 인덱스
(플랫폼 백엔드로 이관된 조회 전용 API, 색인 자체는 여전히 Data Prepper가 담당)."""
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Response

from app.opensearch_client import client as opensearch_client
from app.config import settings
from app.pagination import decode_cursor, set_next_cursor_header

router = APIRouter(prefix="/logs", tags=["logs"])

# @timestamp만으로는 같은 밀리초에 여러 이벤트가 몰리면(예: k8s_audit 폭주) 정렬이
# 불안정해서 search_after 커서가 그 지점에서 건너뛰거나 중복될 수 있다 - event.id
# (keyword, 항상 유일)를 2차 정렬키로 더해 완전히 결정적인 순서를 만든다.
_SORT = [{"@timestamp": {"order": "desc"}}, {"event.id": {"order": "desc"}}]


@router.get("")
async def search_logs(
    response: Response,
    module: Optional[str] = None,
    min_severity: Optional[int] = None,
    q: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    limit: int = 50,
    cursor: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """cursor 없이 호출하면 최신순 첫 페이지. 응답에 X-Next-Cursor 헤더가 실려오면
    (=이 페이지가 꽉 찼다는 뜻, 더 있을 가능성이 있음) 그 값을 다음 호출의 cursor로
    그대로 넘기면 이어서 오래된 쪽으로 페이지가 이어진다 - OpenSearch의 search_after
    방식이라 from+size 방식과 달리 몇 페이지를 넘어가든 성능이 떨어지지 않고,
    from+size의 기본 10000건 조회 한도(index.max_result_window)에도 걸리지 않는다."""
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

    page_size = min(limit, 500)
    body: Dict[str, Any] = {"query": query, "sort": _SORT, "size": page_size}
    if cursor:
        body["search_after"] = decode_cursor(cursor)

    result = await opensearch_client.search(
        index=settings.attack_log_index_pattern,
        body=body,
    )
    hits = result["hits"]["hits"]
    if len(hits) == page_size:
        set_next_cursor_header(response, hits[-1]["sort"])
    return [hit["_source"] for hit in hits]
