"""OpenSearch 클라이언트 - Logs API(/logs)와 Stats API(/stats)가 attack-logs-* 인덱스를
조회할 때 쓴다. normalizer/Data Prepper 쪽과는 무관한 읽기 전용 조회 클라이언트.
FastAPI가 전부 async라 AsyncOpenSearch를 쓴다 (이벤트 루프 블로킹 방지)."""
from opensearchpy import AsyncOpenSearch

from app.config import settings

client = AsyncOpenSearch(hosts=[settings.opensearch_url])
