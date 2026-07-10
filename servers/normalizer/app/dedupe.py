"""dedupe (P3-2). audit=auditID / was·waf·falco=sha256(observedTimeUnixNano + "|" +
원본 body). Redis SETNX TTL 1h.

observedTimeUnixNano는 otel-collector가 로그 레코드 관측 시점에 부여하는 OTLP 표준
필드라 재전송에도 불변이고, 초 단위 타임스탬프만 쓰면 생기는 충돌 문제가 없다.

이 키가 곧 NormalizedEvent.event.id이자 OpenSearch 문서 _id다 (P6-1) - Data Prepper
sink가 이 값을 _id로 쓰면 중복 색인 방지가 별도 로직 없이 그냥 따라온다 (P3-7).
"""
import hashlib
from typing import Any, Dict

import redis.asyncio as redis

from app.config import settings

_redis = redis.from_url(settings.redis_url, decode_responses=True)


def compute_dedupe_key(
    source: str, payload: Dict[str, Any], original: str, observed_time_unix_nano: str
) -> str:
    if source == "audit":
        audit_id = payload.get("auditID")
        if audit_id:
            return audit_id
    return hashlib.sha256(f"{observed_time_unix_nano}|{original}".encode("utf-8")).hexdigest()


async def is_duplicate(dedupe_key: str) -> bool:
    """True면 이미 처리된 이벤트 (SETNX 실패 = 이미 키가 존재)."""
    acquired = await _redis.set(
        f"dedupe:{dedupe_key}", "1", nx=True, ex=settings.dedupe_ttl_seconds
    )
    return acquired is None
