"""OpenSearch 클라이언트 - Logs API(/logs)와 Stats API(/stats)가 attack-logs-* 인덱스를
조회할 때 쓴다. normalizer/Data Prepper 쪽과는 무관한 읽기 전용 조회 클라이언트.
FastAPI가 전부 async라 AsyncOpenSearch를 쓴다 (이벤트 루프 블로킹 방지)."""
import asyncio

from opensearchpy import AsyncOpenSearch

from app.config import settings

client = AsyncOpenSearch(hosts=[settings.opensearch_url])


async def start() -> None:
    """AsyncOpenSearch(...) 생성 자체는 지연 연결이라(실제 요청 전까지 커넥션을 안 맺음)
    즉시 실패하지 않지만, 기동 시점에 ping()으로 한 번 확인해서 OpenSearch가 아직
    안 떴을 때를 Postgres/ClickHouse/Kafka와 동일한 재시도 루프로 흡수한다.
    ping()이 예외를 던지는지 False를 반환하는지 이 환경에서 opensearch-py 실물로
    검증하지 못해 - 둘 다 재시도로 처리하도록 방어적으로 작성함."""
    while True:
        try:
            if await client.ping():
                return
        except Exception:
            pass
        print("[platform-api] OpenSearch 연결 실패, 3초 후 재시도")
        await asyncio.sleep(3)
