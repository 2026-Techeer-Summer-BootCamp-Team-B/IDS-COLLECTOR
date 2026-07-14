"""ClickHouse 클라이언트 - app/analytics_api.py가 security_events_analytics 테이블을
조회할 때 쓴다. app/db.py(asyncpg pool)와 같은 start()/stop()/client() lifecycle
패턴 - main.py의 startup/shutdown 훅에서 관리한다."""
import asyncio
from typing import Optional

import clickhouse_connect
from clickhouse_connect.driver.asyncclient import AsyncClient

from app.config import settings

_client: Optional[AsyncClient] = None


async def start() -> None:
    """get_async_client는 생성 시점에 핸드셰이크를 하므로 ClickHouse가 아직 안 뜬
    상태로 기동하면 예외가 난다 - Postgres/Kafka와 동일한 재시도 루프로 기동 순서
    경쟁을 흡수한다."""
    global _client
    while True:
        try:
            _client = await clickhouse_connect.get_async_client(
                host=settings.clickhouse_host,
                port=settings.clickhouse_port,
                username=settings.clickhouse_user,
                password=settings.clickhouse_password,
            )
            break
        except Exception as e:
            print(f"[platform-api] ClickHouse 연결 실패, 3초 후 재시도: {e}")
            await asyncio.sleep(3)


async def stop() -> None:
    if _client:
        # AsyncClient.close()는 이름과 달리 coroutine이 아니라 일반 메서드다
        # (clickhouse-connect==0.8.3에서 실측 확인) - await하면 TypeError.
        _client.close()


def client() -> AsyncClient:
    assert _client is not None, "clickhouse_client.start()를 먼저 호출해야 함"
    return _client
