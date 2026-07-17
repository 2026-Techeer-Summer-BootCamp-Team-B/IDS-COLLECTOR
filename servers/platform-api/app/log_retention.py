"""데이터 보존 정책 집행 - log_policies 테이블 값을 실제로 집행한다.

3등급 체계(docs/reports/repo-audit-20260715.md §3, docs/파이프라인 계약v1.2.md 보존
정책 섹션 - 2026-07-16):
  - 기록(record): Postgres incidents/incident_events/audit_logs - 기본 365일
  - 원본(raw):    OpenSearch otel-logs-raw-* - 기본 30일
  - 파생(derived): OpenSearch attack-logs-* - 기본 14일
(ClickHouse security_events_analytics는 이 폴링이 아니라 테이블 자체 TTL로 집행된다 -
datastore/clickhouse/init/001-kafka-engine.sql 참고. 여긴 Postgres/OpenSearch 몫만 다룬다.)

이전(~2026-07-15) 버전은 OpenSearch를 delete_by_query(문서 단위 삭제)로 지웠는데,
그러면 문서가 다 비워져도 일별 인덱스 자체(샤드)는 안 지워져 무한 누적됐다(위 감사
§3.1). 이번에 인덱스 자체를 통삭제(DELETE index)하는 방식으로 바꿨다 - 그 대신
"이 문서가 정확히 며칠 됐는지"가 아니라 "이 인덱스(하루 단위)가 cutoff보다 오래됐는지"
기준이라 최대 하루 정도 오차가 생길 수 있다(하루 단위 인덱스라 실질적 영향 없음).

otel-logs-raw-*(원본 포렌식 사본)는 예전엔 "항상 남는 원본"이라 이 정책 대상이
아니었는데, 3등급 체계에서 원본도 30일 보존으로 편입됐다(계약 v1.2) - 무기한
누적 문제(감사 §3.1)를 해소하기 위함.

레이어별 archive_enabled=false는 "그 레이어는 보존기간 집행 자체를 끈다"는 뜻으로
재정의됐다(기존엔 hot/cold 2단계 중 cold 구간만 건너뛰는 의미였으나, hot/cold
구분 자체가 죽었으므로 이 필드도 단순 on/off 스위치로 정직화 - 013-data-policy.sql/
023-log-policies-retention-tiers.sql 참고).
"""
import asyncio
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Optional

from app.config import settings
from app.db import pool
from app.opensearch_client import client as opensearch_client

_LAYER_RECORD = "record"
_LAYER_RAW = "raw"
_LAYER_DERIVED = "derived"

_RAW_INDEX_PREFIX = "otel-logs-raw-"
# attack-logs-* 프리픽스는 settings.attack_log_index_pattern("attack-logs-*")에서
# 트레일링 "*"만 떼서 재사용한다 - 다른 곳(app/logs_api.py, app/stats_api.py)과
# 인덱스 패턴 소스를 하나로 유지하기 위함.
_DERIVED_INDEX_PREFIX = settings.attack_log_index_pattern.rstrip("*")

_PG_RETENTION_BATCH_LIMIT = 5000  # 한 폴링 주기당 테이블별 최대 삭제 행 수 - 대량
# 삭제로 인한 장기 락을 피하려고 배치를 나눈다. 이번 주기에 못 지운 나머지는
# 다음 주기(poll_intervals.log_retention_interval_seconds)에 자연스럽게 이어서 지운다.

_DEFAULT_INTERVAL_SECONDS = 3600  # poll_intervals 행이 없는 극단적 상황(마이그레이션
# 누락 등)에 대비한 fail-open 기본값 - retention은 alert 폴링과 달리 지연돼도
# 사용자가 바로 체감하지 않으니 1시간으로 넉넉히 잡았다.


async def _current_interval_seconds() -> float:
    async with pool().acquire() as conn:
        value = await conn.fetchval(
            "SELECT seconds FROM poll_intervals WHERE key = 'log_retention_interval_seconds'"
        )
    return value if value is not None else _DEFAULT_INTERVAL_SECONDS


async def _layer_policy(layer: str) -> Optional[Dict[str, Any]]:
    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            "SELECT retention_days, archive_enabled FROM log_policies WHERE layer = $1", layer
        )
    return dict(row) if row else None


def _parse_index_date(index_name: str, prefix: str) -> Optional[date]:
    """"attack-logs-2026.07.15" -> date(2026, 7, 15). prefix가 안 맞거나 나머지가
    yyyy.MM.dd 형식이 아니면 None - 호출부가 삭제하지 않고 로그만 남기는 안전장치."""
    if not index_name.startswith(prefix):
        return None
    suffix = index_name[len(prefix):]
    try:
        return datetime.strptime(suffix, "%Y.%m.%d").date()
    except ValueError:
        return None


async def _delete_old_indices(index_prefix: str, retention_days: int) -> None:
    cutoff = date.today() - timedelta(days=retention_days)
    try:
        catalog = await opensearch_client.cat.indices(index=f"{index_prefix}*", format="json")
    except Exception as e:
        print(f"[platform-api] {index_prefix}* 인덱스 목록 조회 실패, 다음 주기에 재시도: {e}")
        return

    for entry in catalog:
        index_name = entry.get("index", "")
        index_date = _parse_index_date(index_name, index_prefix)
        if index_date is None:
            print(f"[platform-api] 보존기간 판단 불가(인덱스명 날짜 파싱 실패) - 삭제 건너뜀: {index_name}")
            continue
        if index_date >= cutoff:
            continue
        try:
            await opensearch_client.indices.delete(index=index_name)
            print(f"[platform-api] 보존기간 초과 인덱스 삭제: {index_name} (cutoff={cutoff.isoformat()})")
        except Exception as e:
            print(f"[platform-api] 인덱스 삭제 실패, 다음 주기에 재시도: {index_name} - {e}")


async def _enforce_opensearch_retention() -> None:
    derived = await _layer_policy(_LAYER_DERIVED)
    if derived and derived["archive_enabled"]:
        await _delete_old_indices(_DERIVED_INDEX_PREFIX, derived["retention_days"])

    raw = await _layer_policy(_LAYER_RAW)
    if raw and raw["archive_enabled"]:
        await _delete_old_indices(_RAW_INDEX_PREFIX, raw["retention_days"])


async def _delete_batch(delete_sql: str, *params: Any) -> int:
    async with pool().acquire() as conn:
        rows = await conn.fetch(delete_sql, *params)
    return len(rows)


async def _enforce_postgres_retention() -> None:
    """1등급(기록) 레이어 집행 - audit_logs는 나이만으로, incidents는 나이+상태로
    판단한다. incident_events는 incidents.id를 ON DELETE CASCADE로 참조하므로
    (datastore/postgres/init/001-schema.sql) incidents만 지우면 같이 지워진다 -
    별도 삭제 불필요."""
    record = await _layer_policy(_LAYER_RECORD)
    if not record or not record["archive_enabled"]:
        return

    cutoff = datetime.now(timezone.utc) - timedelta(days=record["retention_days"])

    audit_deleted = await _delete_batch(
        """
        WITH doomed AS (
            SELECT id FROM audit_logs WHERE created_at < $1 LIMIT $2
        )
        DELETE FROM audit_logs WHERE id IN (SELECT id FROM doomed)
        RETURNING id
        """,
        cutoff,
        _PG_RETENTION_BATCH_LIMIT,
    )
    if audit_deleted:
        print(f"[platform-api] 보존기간 초과 audit_logs 삭제: cutoff={cutoff.isoformat()} deleted={audit_deleted}건")

    # status가 open/investigating인 인시던트는 나이와 무관하게 삭제 금지 - 아직
    # 처리 중인 사고를 지워버리면 안 되므로 status='closed'인 것만 대상으로 한다.
    incidents_deleted = await _delete_batch(
        """
        WITH doomed AS (
            SELECT id FROM incidents
            WHERE status = 'closed' AND updated_at < $1
            LIMIT $2
        )
        DELETE FROM incidents WHERE id IN (SELECT id FROM doomed)
        RETURNING id
        """,
        cutoff,
        _PG_RETENTION_BATCH_LIMIT,
    )
    if incidents_deleted:
        print(
            f"[platform-api] 보존기간 초과 incidents 삭제(incident_events 연쇄 삭제 포함): "
            f"cutoff={cutoff.isoformat()} deleted={incidents_deleted}건"
        )


async def _enforce_retention() -> None:
    await _enforce_opensearch_retention()
    await _enforce_postgres_retention()


async def poll_loop() -> None:
    while True:
        interval = _DEFAULT_INTERVAL_SECONDS
        try:
            await _enforce_retention()
            interval = await _current_interval_seconds()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[platform-api] 보존기간 집행 실패, 다음 주기에 재시도: {e}")
        await asyncio.sleep(interval)
