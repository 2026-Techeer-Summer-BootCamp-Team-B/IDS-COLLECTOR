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

_redis = redis.from_url(
    settings.redis_url,
    decode_responses=True,
    socket_connect_timeout=settings.redis_socket_connect_timeout_seconds,
    socket_timeout=settings.redis_socket_timeout_seconds,
)


def compute_dedupe_key(
    source: str, payload: Dict[str, Any], original: str, observed_time_unix_nano: str
) -> str:
    if source == "audit":
        audit_id = payload.get("auditID")
        if audit_id:
            return audit_id
    return hashlib.sha256(f"{observed_time_unix_nano}|{original}".encode("utf-8")).hexdigest()


async def is_duplicate(dedupe_key: str) -> bool:
    """True면 이미 처리된 이벤트 (SETNX 실패 = 이미 키가 존재).

    Redis 자체가 순단이면 False(중복 아님)로 fail-open한다 - 이벤트 유실(fail-closed)보다
    중복 통과가 안전하다는 판단(감사 O4, docs/reports/repo-audit-20260715.md):
      - at-least-once 계약과 정합 - dedupe는 원래 "중복을 흡수하는" 보조 계층이지
        전달 자체를 막는 게이트가 아니다.
      - OpenSearch attack-logs-*는 _id=event.id(dedupe 키)라 재색인돼도 문서가
        덮어써질 뿐 중복 생성되지 않는다 - 자연 멱등.
      - correlation-engine의 인시던트 upsert도 시나리오+상관키+상태로 병합하고
        (app/incidents.py upsert_incident), threshold 시나리오는 쿨다운까지 있어
        중복 이벤트가 중복 인시던트로 이어지지 않는다 - 하류에 또 다른 흡수
        계층이 있다.
    Redis가 완전히 죽은 상태가 길어지면(예외가 계속 나면) 이 함수 자체는 항상
    False만 반환해 재시도 없이 통과하므로, main.py의 3회 재시도+DLQ 경로(다른
    실패 유형용)와는 별개로 여기서 막히지 않는다 - dedupe 실효성만 일시적으로
    떨어질 뿐 파이프라인은 멈추지 않는다."""
    try:
        acquired = await _redis.set(
            f"dedupe:{dedupe_key}", "1", nx=True, ex=settings.dedupe_ttl_seconds
        )
    except Exception as e:
        print(f"[normalizer] WARNING: dedupe Redis 조회 실패, fail-open(중복 아님으로 처리) - {e}")
        return False
    return acquired is None


async def release(dedupe_key: str) -> None:
    """is_duplicate()의 SETNX 클레임을 되돌린다. dedupe는 emit 전에 먼저 키를
    선점하므로(동시성 있는 진짜 중복 redelivery를 원자적으로 막기 위함), enrich/
    exclusion/emit 중 하나가 실패하면 "선점만 되고 실제로는 emit 안 된" 상태가
    남는다 - main.py가 offset 커밋 없이 재시도하게 해도, 재시도 때 is_duplicate()가
    "이미 처리함"으로 오판해서 그 이벤트가 TTL(1h) 동안 영구히 스킵된다(실측 확인,
    2026-07-15). main.py의 _process_body가 클레임 이후 실패 시 이 함수로 클레임을
    풀어서 재시도가 실제로 재시도되게 한다."""
    await _redis.delete(f"dedupe:{dedupe_key}")
