"""GeoIP enrichment 모듈. MaxMind GeoLite2-City(.mmdb)를 geoip2로 조회해서 국가/도시/
위경도를 채운다 - GeOLite2-City는 geoip2fast(country-only 배포판)와 달리 city 단위
좌표를 실제로 갖고 있다.

같은 IP 반복 조회를 피하려고 Redis에 캐싱한다(dedupe.py와 같은 redis.asyncio 클라이언트
스타일 - IP-지리 매핑은 사실상 안 바뀌므로 TTL을 길게(7일) 둔다). Redis가 죽어 있으면
dedupe.py와 같은 이유로 fail-open - 캐시를 못 쓸 뿐 조회 자체(파일 mmap 기반이라
네트워크 의존 없음)는 계속 정상 동작해야 한다.

라이선스: 여기서 쓰는 GeoLite2 데이터는 MaxMind가 만든 것으로, MaxMind EULA에 따라
"This product includes GeoLite2 data created by MaxMind, available from
https://www.maxmind.com" 표기가 필요하다(README 참고). .mmdb 파일 자체(53MB, 팀 배포용)는
git에 커밋하지 않는다(servers/normalizer/.gitignore) - 로컬/배포 전에 직접 내려받아
servers/normalizer/data/GeoLite2-City.mmdb 자리에 둘 것(GEOIP_DB_PATH로 경로 변경 가능,
app/config.py 참고).
"""
import ipaddress
import json
from typing import Optional, TypedDict

import geoip2.database
import geoip2.errors
import redis.asyncio as redis

from app.config import settings

_reader = geoip2.database.Reader(settings.geoip_db_path)
_redis = redis.from_url(settings.redis_url, decode_responses=True)

_CACHE_TTL_SECONDS = 7 * 24 * 3600
_CACHE_PREFIX = "geoip:"


class GeoInfo(TypedDict):
    country_iso_code: Optional[str]
    city_name: Optional[str]
    lat: Optional[float]
    lon: Optional[float]


_EMPTY: GeoInfo = {"country_iso_code": None, "city_name": None, "lat": None, "lon": None}


def _is_routable_public(ip: str) -> bool:
    """사설/루프백/예약/멀티캐스트/링크로컬 대역은 GeoLite2에도 안 실려 있어 조회
    자체가 무의미하다 - waf_actions.py의 random_source_ip()는 이미 공인 대역만
    뽑지만, falco/k8s_audit 등 다른 소스의 source_ip는 클러스터 내부 IP일 수 있어
    여기서도 한 번 더 걸러낸다."""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return not (
        addr.is_private
        or addr.is_loopback
        or addr.is_reserved
        or addr.is_multicast
        or addr.is_unspecified
        or addr.is_link_local
    )


def _query(ip: str) -> GeoInfo:
    """실패 처리: DB 미매치(AddressNotFoundError) 또는 위경도가 비어 있으면(Anycast
    IP 등 실제로 흔함, 예: 1.1.1.1) country_iso_code까지 전부 None으로 통일해서
    반환한다 - analytics_api.py가 country_iso_code를 '??'로 취급해 지도 집계에서
    제외한다."""
    try:
        result = _reader.city(ip)
    except geoip2.errors.AddressNotFoundError:
        return dict(_EMPTY)

    lat, lon = result.location.latitude, result.location.longitude
    if lat is None or lon is None or not result.country.iso_code:
        return dict(_EMPTY)

    return {
        "country_iso_code": result.country.iso_code,
        "city_name": result.city.name,
        "lat": lat,
        "lon": lon,
    }


async def lookup(ip: str) -> GeoInfo:
    if not _is_routable_public(ip):
        return dict(_EMPTY)

    cache_key = f"{_CACHE_PREFIX}{ip}"
    try:
        cached = await _redis.get(cache_key)
    except Exception as e:
        print(f"[normalizer] WARNING: GeoIP 캐시 조회 실패, 캐시 없이 직접 조회 - {e}")
        return _query(ip)

    if cached is not None:
        return json.loads(cached)

    info = _query(ip)
    try:
        await _redis.set(cache_key, json.dumps(info), ex=_CACHE_TTL_SECONDS)
    except Exception as e:
        print(f"[normalizer] WARNING: GeoIP 캐시 저장 실패(무시하고 계속) - {e}")
    return info
