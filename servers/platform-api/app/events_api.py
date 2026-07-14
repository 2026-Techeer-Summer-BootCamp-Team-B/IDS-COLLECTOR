"""개별 정규화 이벤트 실시간 티커 (/events/recent) - app/event_stream.py(WebSocket,
events.normalized 직접 tail)를 대체한다 (계약 v1.1 §7, 2026-07-14 팀 합의로 WS/pub-sub
경로 완전 제거 결정). 대시보드 하단 라이브 티커/CRITICAL 팝업이 이 엔드포인트를 주기
폴링해서 소비한다 - 인시던트 단위 폴링(GET /incidents?since=, app/incidents_api.py)과
같은 since 패턴이지만, 여긴 정규화 이벤트 하나하나(was/waf/falco/k8s_audit)를 그대로
반환한다.

Kafka를 더 이상 직접 구독하지 않는다 - 색인은 Data Prepper가 담당하고(P6-4), 이
엔드포인트는 app/logs_api.py와 동일하게 attack-logs-* OpenSearch 인덱스를 읽기만 한다."""
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Response

from app.config import settings
from app.opensearch_client import client as opensearch_client
from app.pagination import decode_cursor, set_next_cursor_header

router = APIRouter(prefix="/events", tags=["events"])


@router.get("/recent")
async def recent_events(
    response: Response,
    since: Optional[str] = None,
    limit: int = 50,
    cursor: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """since(ISO8601)를 주면 그 시각 이후 이벤트만 오래된순으로 반환한다(호출부는 마지막
    항목의 @timestamp를 다음 호출의 since로 그대로 넘기면 됨) - since가 없으면(최초 로드)
    최신순 상위 limit건을 반환한다. limit 기본 50, 최대 200.

    limit은 한 페이지 크기다(2026-07-15, /logs·/incidents와 동일한 커서 페이지네이션
    추가 - app/pagination.py 참고). 응답이 꽉 찼으면 X-Next-Cursor 헤더가 실려오고,
    그 값을 다음 호출의 cursor로 넘기면 같은 방향(since 있으면 오래된순으로 계속,
    없으면 최신순으로 계속)으로 이어서 페이지가 나온다 - since 자체도 일종의 진행
    커서라 실시간 폴링(라이브 티커)에는 계속 since만 쓰면 되고, cursor는 한 번의
    응답이 limit에 꽉 차서 그 사이에 놓친 이벤트가 있을 수 있는 경우(예: 폴링
    주기 사이에 limit건보다 많은 이벤트가 쌓였을 때)에 이어서 받는 용도다."""
    limit = min(limit, 200)

    if since:
        query: Dict[str, Any] = {"bool": {"filter": [{"range": {"@timestamp": {"gt": since}}}]}}
        sort_order = "asc"
    else:
        query = {"match_all": {}}
        sort_order = "desc"

    # @timestamp만으로는 동시 발생 이벤트가 몰릴 때 정렬이 불안정해서 search_after
    # 커서가 그 지점에서 건너뛰거나 중복될 수 있다 - event.id(keyword, 항상 유일)를
    # 2차 정렬키로 더해 완전히 결정적인 순서를 만든다(logs_api.py와 동일 이유).
    body: Dict[str, Any] = {
        "query": query,
        "sort": [{"@timestamp": {"order": sort_order}}, {"event.id": {"order": sort_order}}],
        "size": limit,
    }
    if cursor:
        body["search_after"] = decode_cursor(cursor)

    result = await opensearch_client.search(
        index=settings.attack_log_index_pattern,
        body=body,
    )
    hits = result["hits"]["hits"]
    if len(hits) == limit:
        set_next_cursor_header(response, hits[-1]["sort"])
    return [hit["_source"] for hit in hits]
