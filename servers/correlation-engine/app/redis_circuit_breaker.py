"""Redis 서킷브레이커 래퍼 (P8-1) - correlation-engine이 Redis에 의존하는 지점
(threshold 카운터, sequence 상태, 쿨다운, enabled 플래그, rules.py 전체)을
rules.py 코드 한 줄도 안 건드리고 보호한다. main.py에서 진짜 redis 클라이언트 대신
이 래퍼를 ScenarioEngine에 넘기면 된다.

CLOSED(정상) -> OPEN(차단) -> HALF_OPEN(시험) 3단계로 움직인다.
"""
import asyncio
import time
from typing import Optional


class CircuitOpenError(Exception):
    """회로가 열려 있어 이번 호출을 건너뛰었다는 뜻."""


class RedisCircuitBreaker:
    def __init__(
        self,
        redis_client,
        *,
        call_timeout_seconds: float = 0.5,       # 이 시간 넘으면 "느린 호출" = 실패로 카운트
        failure_rate_threshold: float = 0.5,     # 최근 호출 중 이 비율 이상 실패하면 OPEN
        minimum_number_of_calls: int = 10,       # 판단하기 전 최소 이만큼은 호출이 쌓여야 함
        reset_timeout_seconds: float = 30.0,     # OPEN 상태를 최소 이만큼 유지한 뒤 HALF_OPEN 시도
        window_seconds: float = 60.0,            # 실패율 계산에 쓰는 최근 시간 창
    ) -> None:
        self._redis = redis_client
        self._call_timeout = call_timeout_seconds
        self._failure_rate_threshold = failure_rate_threshold
        self._minimum_number_of_calls = minimum_number_of_calls
        self._reset_timeout = reset_timeout_seconds
        self._window_seconds = window_seconds

        self._state = "CLOSED"
        self._opened_at: Optional[float] = None
        self._recent_calls: list[tuple[float, bool]] = []  # (timestamp, was_failure)

    def _prune_old_calls(self, now: float) -> None:
        cutoff = now - self._window_seconds
        self._recent_calls = [(t, f) for t, f in self._recent_calls if t >= cutoff]

    def _record(self, failed: bool) -> None:
        now = time.monotonic()

        if self._state == "HALF_OPEN":
            if failed:
                self._state = "OPEN"
                self._opened_at = now
            else:
                self._state = "CLOSED"
                self._recent_calls = []
            return

        self._prune_old_calls(now)
        self._recent_calls.append((now, failed))

        if len(self._recent_calls) < self._minimum_number_of_calls:
            return

        failure_rate = sum(1 for _, f in self._recent_calls if f) / len(self._recent_calls)
        if failure_rate >= self._failure_rate_threshold:
            self._state = "OPEN"
            self._opened_at = now

    def _should_attempt(self) -> bool:
        if self._state == "OPEN":
            assert self._opened_at is not None
            if time.monotonic() - self._opened_at < self._reset_timeout:
                return False
            self._state = "HALF_OPEN"
        return True

    async def _call(self, bound_method, *args, **kwargs):
        if not self._should_attempt():
            raise CircuitOpenError(f"Redis 서킷 open 상태 (state={self._state})")

        try:
            result = await asyncio.wait_for(
                bound_method(*args, **kwargs), timeout=self._call_timeout
            )
        except (asyncio.TimeoutError, ConnectionError, OSError):
            self._record(failed=True)
            raise
        else:
            self._record(failed=False)
            return result

    # rules.py가 실제로 쓰는 명령만 그대로 흉내낸다 - 새 Redis 명령을 rules.py에서
    # 쓰게 되면 여기도 같이 추가해야 한다(안 그러면 AttributeError).
    async def get(self, *a, **kw):
        return await self._call(self._redis.get, *a, **kw)

    async def set(self, *a, **kw):
        return await self._call(self._redis.set, *a, **kw)

    async def incr(self, *a, **kw):
        return await self._call(self._redis.incr, *a, **kw)

    async def expire(self, *a, **kw):
        return await self._call(self._redis.expire, *a, **kw)

    async def sadd(self, *a, **kw):
        return await self._call(self._redis.sadd, *a, **kw)

    async def scard(self, *a, **kw):
        return await self._call(self._redis.scard, *a, **kw)

    async def delete(self, *a, **kw):
        return await self._call(self._redis.delete, *a, **kw)