from opensearchpy import OpenSearch

from app.config import settings

client = OpenSearch(hosts=[settings.opensearch_url])

# 매핑을 미리 명시해서, OpenSearch가 자동으로 잘못된 타입(keyword를 text로 등)을
# 추론하는 걸 방지한다. (예전에 Elasticsearch에서 이 문제로 통계 API가 막혔던 적 있음)
_ATTACK_LOG_MAPPING = {
    "mappings": {
        "properties": {
            "@timestamp": {"type": "date"},
            "event_id": {"type": "keyword"},
            "event_module": {"type": "keyword"},
            "event_kind": {"type": "keyword"},
            "event_action": {"type": "keyword"},
            "event_outcome": {"type": "keyword"},
            "event_severity": {"type": "integer"},
            "event_original": {"type": "text"},
            "source_ip": {"type": "keyword"},
            "user_name": {"type": "keyword"},
            "orchestrator_namespace": {"type": "keyword"},
            "orchestrator_resource_name": {"type": "keyword"},
            "http_request_method": {"type": "keyword"},
            "url_path": {"type": "keyword"},
            "http_response_status_code": {"type": "integer"},
            "user_agent_original": {"type": "text"},
            "geo_country_iso_code": {"type": "keyword"},
            "geo_city_name": {"type": "keyword"},
        }
    }
}


def ensure_index_exists() -> None:
    if not client.indices.exists(index=settings.attack_log_index):
        client.indices.create(index=settings.attack_log_index, body=_ATTACK_LOG_MAPPING)