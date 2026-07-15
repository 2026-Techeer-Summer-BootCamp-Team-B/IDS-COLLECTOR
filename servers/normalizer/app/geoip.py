"""
GeoIP enrichment 모듈.

geoip2fast(MIT, https://github.com/rabuchaim/geoip2fast)를 쓴다 - MaxMind처럼
계정/라이선스 키를 받아 별도로 .mmdb를 내려받을 필요 없이, pip 패키지 자체에
국가 단위 조회용 DB가 번들돼 있어서 오프라인으로 바로 동작한다. city 단위는
이 DB가 채워주지 않아서(country-only 배포판) city_name은 항상 None - 실제로
대시보드(useGeoStats.js)도 country_iso_code만 쓰고 city_name은 어디서도 안 읽는다.
"""
from typing import Optional, TypedDict

from geoip2fast import GeoIP2Fast

_geoip = GeoIP2Fast()


class GeoInfo(TypedDict):
    country_iso_code: Optional[str]
    city_name: Optional[str]


def lookup(ip: str) -> GeoInfo:
    """IP를 받아 국가 정보를 반환. 사설 대역/DB 미매치는 둘 다 None
    (analytics_api.py가 country_iso_code를 '??'로 취급해 지도에서 제외)."""
    result = _geoip.lookup(ip)
    if result.is_private or not result.country_code or result.country_code == "--":
        return {"country_iso_code": None, "city_name": None}

    return {"country_iso_code": result.country_code, "city_name": None}
