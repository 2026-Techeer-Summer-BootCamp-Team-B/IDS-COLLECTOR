"""Stats API의 ClickHouse 집계분(/stats/timeseries, /stats/geo, /stats/k8s-targets,
/stats/top-ips) - app/stats_api.py(OpenSearch 기반 module/severity terms agg)와
같은 "/stats" prefix를 나눠 쓰는 별도 라우터다. OpenSearch는 검색/역인덱스용,
ClickHouse(servers/datastore/clickhouse/init/001-kafka-engine.sql이 events.normalized를
직접 구독해서 채우는 security_events_analytics 테이블)는 대량 컬럼형 집계용으로
역할이 나뉜다(README 참고) - 시계열 버킷/Top-N류는 전부 여기서 처리한다."""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException

from app.clickhouse_client import client

router = APIRouter(prefix="/stats", tags=["stats"])

# 대시보드 timeSeries.js의 RANGE_PRESETS와 동일한 키/lookback/bucket 매핑
# (lookbackMs/1000, bucketMs/1000) - 프론트가 쓰는 프리셋 키를 그대로 받는다.
_RANGE_PRESETS: Dict[str, tuple[int, int]] = {
    "15m": (900, 60),
    "1h": (3600, 300),
    "6h": (21600, 1800),
    "24h": (86400, 3600),
    "7d": (604800, 21600),
    "30d": (2592000, 86400),
}


def _time_filter(start: Optional[str], end: Optional[str]) -> tuple[str, Dict[str, Any]]:
    """start/end(ISO8601, 기존 /logs·/stats와 동일 관례)가 있으면 WHERE 조각과 바인딩
    파라미터를 만든다 - 둘 다 없으면 전체 기간(빈 문자열/빈 dict)."""
    clauses = []
    params: Dict[str, Any] = {}
    if start:
        clauses.append("timestamp >= %(start)s")
        params["start"] = start
    if end:
        clauses.append("timestamp <= %(end)s")
        params["end"] = end
    return (" WHERE " + " AND ".join(clauses)) if clauses else "", params


@router.get("/timeseries")
async def get_timeseries(range: str = "24h") -> List[Dict[str, Any]]:
    """대시보드 Log Volume 차트용 - range 프리셋 구간을 bucket 단위로 잘라 severity별
    카운트를 반환한다. ClickHouse가 실제 데이터가 있는 구간만 돌려주므로, 프론트의
    buildBuckets()처럼 빈 구간도 0으로 채운 고정 간격 리스트로 맞춰서 내려준다."""
    preset = _RANGE_PRESETS.get(range)
    if preset is None:
        raise HTTPException(
            status_code=400, detail=f"unknown range: {range} (허용값: {sorted(_RANGE_PRESETS)})"
        )
    lookback_seconds, bucket_seconds = preset

    result = await client().query(
        """
        SELECT toStartOfInterval(timestamp, INTERVAL %(bucket_seconds)s SECOND) AS bucket,
               severity, count() AS cnt
        FROM security_events_analytics
        WHERE timestamp >= now() - INTERVAL %(lookback_seconds)s SECOND
        GROUP BY bucket, severity
        ORDER BY bucket
        """,
        parameters={"bucket_seconds": bucket_seconds, "lookback_seconds": lookback_seconds},
    )

    now_epoch = int(datetime.now(timezone.utc).timestamp())
    start_epoch = (now_epoch - lookback_seconds) // bucket_seconds * bucket_seconds
    end_epoch = now_epoch // bucket_seconds * bucket_seconds

    buckets: Dict[int, Dict[str, int]] = {}
    epoch = start_epoch
    while epoch <= end_epoch:
        buckets[epoch] = {}
        epoch += bucket_seconds

    for bucket_dt, severity, cnt in result.result_rows:
        epoch = int(bucket_dt.replace(tzinfo=timezone.utc).timestamp())
        buckets.setdefault(epoch, {})[str(severity)] = cnt

    return [
        {
            "bucket": datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat(),
            "total": sum(sev_counts.values()),
            "by_severity": {**{"1": 0, "2": 0, "3": 0, "4": 0}, **sev_counts},
        }
        for epoch, sev_counts in sorted(buckets.items())
    ]


@router.get("/geo")
async def get_geo(
    start: Optional[str] = None, end: Optional[str] = None, limit: int = 10
) -> List[Dict[str, Any]]:
    """국가별 탐지 건수 (Infrastructure 지도용) - GeoIP 미매치('??')는 제외.
    위경도/국가명은 프론트가 이미 가진 조회 테이블로 조인하면 되므로 코드만 준다."""
    where, params = _time_filter(start, end)
    where = f"{where} AND geo_country_iso_code != '??'" if where else "WHERE geo_country_iso_code != '??'"
    params["limit"] = min(limit, 100)

    result = await client().query(
        f"""
        SELECT geo_country_iso_code, count() AS cnt
        FROM security_events_analytics
        {where}
        GROUP BY geo_country_iso_code
        ORDER BY cnt DESC
        LIMIT %(limit)s
        """,
        parameters=params,
    )
    return [
        {"country_iso_code": code.decode("ascii", errors="replace").rstrip("\x00"), "count": cnt}
        for code, cnt in result.result_rows
    ]


@router.get("/k8s-targets")
async def get_k8s_targets(
    start: Optional[str] = None, end: Optional[str] = None, limit: int = 10
) -> List[Dict[str, Any]]:
    """namespace/리소스별 탐지 건수 (Infrastructure 표용) - 둘 다 빈 문자열인 행
    (k8s_audit 모듈이 아닌 이벤트)은 제외."""
    where, params = _time_filter(start, end)
    empty_clause = "orchestrator_namespace != '' AND orchestrator_resource_name != ''"
    where = f"{where} AND {empty_clause}" if where else f"WHERE {empty_clause}"
    params["limit"] = min(limit, 100)

    result = await client().query(
        f"""
        SELECT orchestrator_namespace, orchestrator_resource_name, count() AS cnt
        FROM security_events_analytics
        {where}
        GROUP BY orchestrator_namespace, orchestrator_resource_name
        ORDER BY cnt DESC
        LIMIT %(limit)s
        """,
        parameters=params,
    )
    return [
        {"namespace": ns, "resource_name": name, "count": cnt}
        for ns, name, cnt in result.result_rows
    ]


@router.get("/top-ips")
async def get_top_ips(
    start: Optional[str] = None, end: Optional[str] = None, limit: int = 10
) -> List[Dict[str, Any]]:
    """출발지 IP별 탐지 건수 (README의 "최근 1시간 최다 공격 IP Top 10" 예시가 이 API) -
    IP 없음 센티널(all-zero IPv6)은 제외. clickhouse-connect가 IPv4-mapped 주소는
    이미 ipaddress.IPv4Address로, 순수 IPv6은 IPv6Address로 자동 변환해서 돌려주므로
    str()로 직렬화하면 된다(실측 확인 - .ipv4_mapped 따로 안 봐도 됨)."""
    where, params = _time_filter(start, end)
    empty_clause = "source_ip != toIPv6OrDefault('')"
    where = f"{where} AND {empty_clause}" if where else f"WHERE {empty_clause}"
    params["limit"] = min(limit, 100)

    result = await client().query(
        f"""
        SELECT source_ip, count() AS cnt
        FROM security_events_analytics
        {where}
        GROUP BY source_ip
        ORDER BY cnt DESC
        LIMIT %(limit)s
        """,
        parameters=params,
    )
    return [{"source_ip": str(ip), "count": cnt} for ip, cnt in result.result_rows]
