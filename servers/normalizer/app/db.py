import asyncio
from typing import Optional

import asyncpg

from app.config import settings

_pool: Optional[asyncpg.Pool] = None


async def start() -> None:
    """asyncpg.create_pool은 min_size만큼 연결을 즉시 맺으려 하므로, Postgres가 아직
    안 뜬 상태로 기동하면 그 자리에서 예외가 난다 - Kafka 컨슈머와 동일한 재시도
    루프로 기동 순서 경쟁을 흡수한다."""
    global _pool
    while True:
        try:
            _pool = await asyncpg.create_pool(dsn=settings.postgres_dsn)
            break
        except Exception as e:
            print(f"[normalizer] Postgres 연결 실패, 3초 후 재시도: {e}")
            await asyncio.sleep(3)


async def stop() -> None:
    if _pool:
        await _pool.close()


def pool() -> asyncpg.Pool:
    assert _pool is not None, "db.start()를 먼저 호출해야 함"
    return _pool
