"""Stats API (/stats). 계층별(was/waf/falco/k8s_audit) 통계 집계 - attack-logs-*
인덱스에 대한 terms aggregation (플랫폼 이관)."""
from collections import defaultdict
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends

from app.auth import get_current_session
from app.config import settings
from app.opensearch_client import client as opensearch_client

router = APIRouter(prefix="/stats", tags=["stats"], dependencies=[Depends(get_current_session)])

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


@router.get("")
async def get_stats(start: Optional[str] = None, end: Optional[str] = None) -> Dict[str, Any]:
    filters = _time_filters(start, end)
    query: Dict[str, Any] = {"match_all": {}} if not filters else {"bool": {"filter": filters}}

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
