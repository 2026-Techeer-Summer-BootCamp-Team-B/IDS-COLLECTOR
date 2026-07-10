from typing import Optional

import asyncpg

from app.config import settings

_pool: Optional[asyncpg.Pool] = None


async def start() -> None:
    global _pool
    _pool = await asyncpg.create_pool(dsn=settings.postgres_dsn)


async def stop() -> None:
    if _pool:
        await _pool.close()


def pool() -> asyncpg.Pool:
    assert _pool is not None, "db.start()를 먼저 호출해야 함"
    return _pool
