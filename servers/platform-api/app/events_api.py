"""개별 정규화 이벤트 실시간 티커 (/events/recent) - app/event_stream.py(WebSocket,
events.normalized 직접 tail)를 대체한다 (계약 v1.1 §7, 2026-07-14 팀 합의로 WS/pub-sub
경로 완전 제거 결정). 대시보드 하단 라이브 티커/CRITICAL 팝업이 이 엔드포인트를 주기
폴링해서 소비한다 - 인시던트 단위 폴링(GET /incidents?since=, app/incidents_api.py)과
같은 since 패턴이지만, 여긴 정규화 이벤트 하나하나(was/waf/falco/k8s_audit)를 그대로
반환한다.

Kafka를 더 이상 직접 구독하지 않는다 - 색인은 Data Prepper가 담당하고(P6-4), 이
엔드포인트는 app/logs_api.py와 동일하게 attack-logs-* OpenSearch 인덱스를 읽기만 한다."""
from typing import Any, Dict, List, Optional

from fastapi import APIRouter

from app.config import settings
from app.opensearch_client import client as opensearch_client

router = APIRouter(prefix="/events", tags=["events"])


@router.get("/recent")
async def recent_events(since: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
    """since(ISO8601)를 주면 그 시각 이후 이벤트만 오래된순으로 반환한다(호출부는 마지막
    항목의 @timestamp를 다음 호출의 since로 그대로 넘기면 됨) - since가 없으면(최초 로드)
    최신순 상위 limit건을 반환한다. limit 기본 50, 최대 200."""
    limit = min(limit, 200)

    if since:
        query: Dict[str, Any] = {"bool": {"filter": [{"range": {"@timestamp": {"gt": since}}}]}}
        sort_order = "asc"
    else:
        query = {"match_all": {}}
        sort_order = "desc"

    result = await opensearch_client.search(
        index=settings.attack_log_index_pattern,
        body={
            "query": query,
            "sort": [{"@timestamp": {"order": sort_order}}],
            "size": limit,
        },
    )
    return [hit["_source"] for hit in result["hits"]["hits"]]
