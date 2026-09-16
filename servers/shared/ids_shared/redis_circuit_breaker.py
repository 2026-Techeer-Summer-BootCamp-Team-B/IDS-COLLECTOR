"""Redis 서킷브레이커 래퍼 (P8-1, 2026-09-16부터 shared로 이동) - Redis에 의존하는
서비스(correlation-engine의 threshold 카운터/sequence 상태/쿨다운/enabled 플래그,
platform-api의 세션 저장/조회)를 감싼다. 원래 correlation-engine/app/에만 있었는데,
platform-api에도 그대로 필요해지면서 각 서비스에 따로 복붙하면 한쪽만 고치고
다른 쪽은 안 고치는 드리프트가 생기기 쉬워(실제로 예외 타입 버그 하나가 이렇게
한쪽에만 있다가 나중에 발견됐다) shared 패키지로 옮겼다.

CLOSED(정상) -> OPEN(차단) -> HALF_OPEN(시험) 3단계로 움직인다.
"""
import asyncio
import time
from typing import Optional

from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import TimeoutError as RedisTimeoutError


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
        except (asyncio.TimeoutError, RedisConnectionError, RedisTimeoutError, OSError):
            # redis-py의 ConnectionError/TimeoutError는 파이썬 내장 예외의 서브클래스가
            # 아니다(RedisError만 상속) - 예전엔 그냥 `ConnectionError`(내장)를 잡고
            # 있어서, 진짜 redis-py가 던지는 연결 리셋/타임아웃은 하나도 안 걸리고
            # 그대로 새어나갔다. 그 경우 _record()가 안 불려서 _should_attempt()가
            # 이미 OPEN->HALF_OPEN으로 바꿔놓은 상태가 그대로 굳어버리고(HALF_OPEN은
            # _should_attempt()의 게이트를 안 거치므로 사실상 무방비 상태), CLOSED로도
            # 못 돌아가는 채로 멈출 수 있었다(2026-09-16, 드릴 중 강제 재시작이
            # 필요했던 정황과 일치해 코드 레벨에서 확인 후 수정).
            self._record(failed=True)
            raise
        else:
            self._record(failed=False)
            return result

    # 각 서비스가 실제로 쓰는 명령만 그대로 흉내낸다 - 새 Redis 명령을 쓰게 되면
    # 여기도 같이 추가해야 한다(안 그러면 AttributeError).
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
