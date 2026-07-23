"""Stats API의 ClickHouse 집계분(/stats/timeseries, /stats/volume, /stats/levels,
/stats/geo, /stats/k8s-targets, /stats/top-ips) - app/stats_api.py(OpenSearch 기반
module/severity terms agg)와 같은 "/stats" prefix를 나눠 쓰는 별도 라우터다.
OpenSearch는 검색/역인덱스용, ClickHouse(servers/datastore/clickhouse/init/
001-kafka-engine.sql이 events.normalized를 직접 구독해서 채우는
security_events_analytics 테이블)는 대량 컬럼형 집계용으로 역할이 나뉜다(README
참고) - 시계열 버킷/Top-N류는 전부 여기서 처리한다.

주의(2026-07-14 실측 발견 및 정리): source IP Top-N은 한때 이 파일과 app/stats_api.py
양쪽에 같은 경로(GET /stats/top-ips)로 중복 정의돼 있었다 - main.py가
stats_router를 analytics_router보다 먼저 include_router()해서 stats_api.py(OpenSearch
terms agg) 쪽만 실제로 라우팅되고 이 파일의 ClickHouse 버전은 영원히 안 잡히는 죽은
코드였다. IP 집계는 이 모듈의 존재 이유 그대로(고카디널리티 컬럼 대상 고속 집계)
ClickHouse가 맞는 저장소라 OpenSearch 쪽을 지우고 이 버전을 정본으로 남겼다 - 응답
계약(`{items:[{source_ip,count}]}`)은 README 문서화된 그대로 유지.

/volume·/levels도 같은 이유로 2026-07-24에 여기로 옮겨왔다(대시보드 "Log Volume"/
"심각도 분포" 위젯이 너무 느리다는 피드백으로 실측 확인 - attack-logs-* 와일드카드
인덱스를 시간 상한 없이, 2~5초 폴링마다 매번 재집계하고 있었다). 이번엔 top-ips와
달리 경로 자체가 안 겹쳤던 케이스라(app/stats_api.py에는 있었지만 이 파일엔 아예
없었음) 라우팅 순서 문제는 없었다 - stats_api.py 쪽 구현을 통째로 지우고 옮겨왔다.
응답 계약은 그대로 유지해서 dashboard/src/hooks/useLogVolume.js·useLogLevels.js는
변경 불필요."""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, HTTPException

from app.clickhouse_client import client
from app.timeparse import parse_iso8601

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
    파라미터를 만든다 - 둘 다 없으면 전체 기간(빈 문자열/빈 dict).

    `timestamp` 컬럼이 DateTime64가 아니라 DateTime이라 ISO8601 문자열('T'/'Z'/밀리초
    포함)을 그대로 바인딩하면 ClickHouse가 파싱을 거부한다(Code 53 TYPE_MISMATCH,
    2026-07-14 /stats/top-ips 500 에러로 실측) - app.timeparse.parse_iso8601로 datetime
    객체로 변환해서 넘기면 clickhouse-connect가 DateTime 컬럼에 맞게 알아서 직렬화한다."""
    clauses = []
    params: Dict[str, Any] = {}
    if start:
        clauses.append("timestamp >= %(start)s")
        params["start"] = parse_iso8601(start)
    if end:
        clauses.append("timestamp <= %(end)s")
        params["end"] = parse_iso8601(end)
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


def _module_severity_where(
    module: Optional[str], min_severity: Optional[int], severity: Optional[int]
) -> Tuple[List[str], Dict[str, Any]]:
    """/volume·/levels가 공유하는 필터 조각 - Overview KPI 카드(Errors/Warnings)
    클릭 필터와 WAS/Falco/K8s Audit 상세 뷰의 module 필터를 WHERE 절 조각과
    바인딩 파라미터로 만든다(app/stats_api.py의 _severity_filters와 같은 우선순위:
    severity 정확히 일치가 있으면 그걸 우선, 없으면 min_severity(">=")."""
    clauses: List[str] = []
    params: Dict[str, Any] = {}
    if module:
        clauses.append("event_module = %(module)s")
        params["module"] = module
    if severity is not None:
        clauses.append("severity = %(severity)s")
        params["severity"] = severity
    elif min_severity is not None:
        clauses.append("severity >= %(min_severity)s")
        params["min_severity"] = min_severity
    return clauses, params


@router.get("/volume")
async def get_volume(
    hours: float = 24,
    buckets: int = 25,
    module: Optional[str] = None,
    min_severity: Optional[int] = None,
    severity: Optional[int] = None,
) -> Dict[str, Any]:
    """Log Volume 차트 - 시간대별 total/errors(severity>=3) 카운트(app/stats_api.py의
    옛 OpenSearch date_histogram 버전과 응답 계약 동일: {bucket_ms, buckets:
    [{ts,total,errors}]}). module이 주어지면 WAS/Falco/K8s Audit 상세 뷰가
    event_module로 필터링해서 같은 차트를 재사용한다. min_severity/severity는
    Overview KPI 카드 클릭 필터.

    toStartOfInterval은 Unix epoch 기준 고정 격자에 버킷을 앵커링한다(OpenSearch
    fixed_interval date_histogram과 동일 성질) - 그래서 total/was/waf/falco/k8s_audit
    다섯 번을 독립적으로 요청해도(각자 다른 시각에 now()를 잡아도) 같은 ts 값으로
    떨어져서 프론트(LogDashboard.jsx)가 ts를 키로 Map 병합할 수 있다. 실제 데이터가
    없는 구간도 ClickHouse가 행 자체를 안 주므로, /stats/timeseries와 같은 방식으로
    빈 버킷을 0으로 채워서 고정 간격 리스트로 맞춘다."""
    now = datetime.now(timezone.utc)
    start = now - timedelta(hours=hours)
    interval_seconds = max(int(hours * 3600 / max(buckets, 1)), 60)

    clauses, params = _module_severity_where(module, min_severity, severity)
    clauses.append("timestamp >= %(start)s")
    params["start"] = start
    params["interval_seconds"] = interval_seconds
    where = "WHERE " + " AND ".join(clauses)

    result = await client().query(
        f"""
        SELECT toStartOfInterval(timestamp, INTERVAL %(interval_seconds)s SECOND) AS bucket,
               countIf(severity >= 3) AS errors, count() AS total
        FROM security_events_analytics
        {where}
        GROUP BY bucket
        ORDER BY bucket
        """,
        parameters=params,
    )

    bucket_counts: Dict[int, Dict[str, int]] = {
        int(bucket_dt.replace(tzinfo=timezone.utc).timestamp()): {"total": total, "errors": errors}
        for bucket_dt, errors, total in result.result_rows
    }

    start_epoch = int(start.timestamp()) // interval_seconds * interval_seconds
    end_epoch = int(now.timestamp()) // interval_seconds * interval_seconds
    out_buckets = []
    epoch = start_epoch
    while epoch <= end_epoch:
        counts = bucket_counts.get(epoch, {"total": 0, "errors": 0})
        out_buckets.append({"ts": epoch * 1000, "total": counts["total"], "errors": counts["errors"]})
        epoch += interval_seconds

    return {"bucket_ms": interval_seconds * 1000, "buckets": out_buckets}


@router.get("/levels")
async def get_levels(
    hours: float = 24,
    module: Optional[str] = None,
    min_severity: Optional[int] = None,
    severity: Optional[int] = None,
) -> Dict[str, Any]:
    """Log Levels 차트 - severity(1~4) 분포(app/stats_api.py의 옛 OpenSearch terms
    agg 버전과 응답 계약 동일: {total, levels:[{severity,count}]}). module이
    주어지면 해당 event_module로만 필터링한다. min_severity/severity는 Overview
    KPI 카드 클릭 필터 - Errors를 누르면 severity>=3만, Warnings를 누르면
    severity==2만 남기고 나머지는 0건으로 보여서 지금 무슨 조건으로 좁혀봤는지가
    막대 자체로도 드러난다(_module_severity_where 참고).

    total은 severity 없는 문서를 걱정해 별도 count(*)를 또 안 돌린다 - severity가
    NOT NULL UInt8 컬럼이라 by-severity 합만으로 항상 정확하다(옛 OpenSearch
    버전의 track_total_hits=true 중복 카운트를 없앤 부분)."""
    start = datetime.now(timezone.utc) - timedelta(hours=hours)
    clauses, params = _module_severity_where(module, min_severity, severity)
    clauses.append("timestamp >= %(start)s")
    params["start"] = start
    where = "WHERE " + " AND ".join(clauses)

    result = await client().query(
        f"""
        SELECT severity, count() AS cnt
        FROM security_events_analytics
        {where}
        GROUP BY severity
        ORDER BY severity
        """,
        parameters=params,
    )

    levels = [{"severity": int(sev), "count": cnt} for sev, cnt in result.result_rows]
    return {"total": sum(level["count"] for level in levels), "levels": levels}


@router.get("/geo")
async def get_geo(
    start: Optional[str] = None, end: Optional[str] = None, limit: int = 10
) -> List[Dict[str, Any]]:
    """도시 단위 탐지 건수 (Infrastructure 지도용) - GeoIP 미매치('??')는 제외.
    위경도는 GeoLite2-City가 실측한 값을 그대로 내려준다(국가 중심좌표 근사가 아님) -
    프론트(WorldMap/Globe3D)는 이 lat/lon을 그대로 찍기만 하면 된다. 같은 도시(같은
    country_iso_code/city_name/lat/lon 조합)는 GROUP BY로 자연히 하나로 합산된다 -
    MaxMind가 같은 도시에는 항상 같은 좌표를 돌려주므로 부동소수점 GROUP BY로도
    안전하다.

    geo_lat=0 AND geo_lon=0(Null Island)도 country_iso_code와 함께 제외한다 - 실제
    관측 좌표가 아니라 `ALTER TABLE ... ADD COLUMN`이 기존 행에 채운 Float64
    기본값이다(2026-07-16, GeoLite2-City 도입 전 쌓인 행은 country만 있고 좌표가
    없었음). 안 걸러내면 그 행들이 전부 지도의 (0,0) 한 점에 겹쳐 찍힌다 - 실제
    IP가 정확히 (0,0)으로 조회될 일은 없어(대서양 한복판) 안전한 센티널이다."""
    where, params = _time_filter(start, end)
    null_island_clause = "geo_country_iso_code != '??' AND NOT (geo_lat = 0 AND geo_lon = 0)"
    where = f"{where} AND {null_island_clause}" if where else f"WHERE {null_island_clause}"
    params["limit"] = max(1, min(limit, 200))

    result = await client().query(
        f"""
        SELECT geo_country_iso_code, geo_city_name, geo_lat, geo_lon, count() AS cnt
        FROM security_events_analytics
        {where}
        GROUP BY geo_country_iso_code, geo_city_name, geo_lat, geo_lon
        ORDER BY cnt DESC
        LIMIT %(limit)s
        """,
        parameters=params,
    )
    return [
        {
            "country_iso_code": code.decode("ascii", errors="replace").rstrip("\x00"),
            "city_name": city or None,
            "lat": lat,
            "lon": lon,
            "count": cnt,
        }
        for code, city, lat, lon, cnt in result.result_rows
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
    params["limit"] = max(1, min(limit, 100))

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
) -> Dict[str, List[Dict[str, Any]]]:
    """출발지 IP별 탐지 건수 (README의 "최근 1시간 최다 공격 IP Top 10" 예시가 이 API) -
    IP 없음 센티널(all-zero IPv6)은 제외. clickhouse-connect가 IPv4-mapped 주소는
    이미 ipaddress.IPv4Address로, 순수 IPv6은 IPv6Address로 자동 변환해서 돌려주므로
    str()로 직렬화하면 된다(실측 확인 - .ipv4_mapped 따로 안 봐도 됨). 응답을
    `{items:[...]}`로 감싸는 건 이 프로젝트 스타일이 아니라, README가 이미 문서화한
    (그리고 한때 이 경로를 실제로 라우팅하던) stats_api.py 버전의 계약과 맞추기 위함 -
    프론트가 그 계약을 보고 만들어졌을 수 있어 응답 모양은 바꾸지 않는다."""
    where, params = _time_filter(start, end)
    empty_clause = "source_ip != toIPv6OrDefault('')"
    where = f"{where} AND {empty_clause}" if where else f"WHERE {empty_clause}"
    params["limit"] = max(1, min(limit, 100))

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
    return {"items": [{"source_ip": str(ip), "count": cnt} for ip, cnt in result.result_rows]}
