"""
GeoIP enrichment 모듈.

⚠️ 지금은 MaxMind GeoLite2 DB 파일을 아직 못 받아서, 더미로 처리한다.
   나중에 실제 .mmdb 파일을 구하면, lookup() 함수 내부만 교체하면 되고
   호출하는 쪽(backend 서비스) 코드는 전혀 안 바뀐다.
"""
from typing import Optional, TypedDict


class GeoInfo(TypedDict):
    country_iso_code: Optional[str]
    city_name: Optional[str]


_PRIVATE_PREFIXES = ("127.", "192.168.", "10.")


def lookup(ip: str) -> GeoInfo:
    """IP를 받아 국가/도시 정보를 반환. 지금은 더미 - 실제 조회 안 함."""
    if ip.startswith(_PRIVATE_PREFIXES):
        return {"country_iso_code": None, "city_name": None}

    return {"country_iso_code": "KR", "city_name": "Seoul"}
