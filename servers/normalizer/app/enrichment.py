"""Enrichment (P3-6): GeoIP + was/waf orchestrator 폴백.

GeoIP는 app/geoip.py의 더미를 그대로 쓴다 (MaxMind .mmdb 확보 후 그 파일만 교체하면 됨).
falco/audit는 자기 payload에서 orchestrator.*를 동적으로 이미 채우므로 여기서 건드리지
않는다 - was/waf도 이제 normalizer.py의 normalize_was/normalize_waf가 각각
nginx-was-logger의 Downward API 값(로그 자체에 실림)과 WAF backend가 Juice Shop
응답 헤더(X-Served-By-Pod/Namespace)에서 옮겨 담은 값으로 orchestrator.*를 동적으로
채운다 - 정적 하드코딩 아님, 재배포/레플리카 증설에도 항상 실제 값을 반영한다.

여기서는 그 값이 비어 있는 경우(예: WAF prevention 모드로 차단되어 Juice Shop 응답
자체가 없었던 요청)에 한해서만 아래 폴백을 채운다 - 폴백 값이 스테일해질 수 있다는
한계는 여전하지만, 정상 경로(대부분의 이벤트)는 이제 이 값에 의존하지 않는다.
"""
from typing import Any, Dict

from app.geoip import lookup as geoip_lookup
from ids_shared.schemas import NormalizedEvent

# 차단(prevention)돼서 Juice Shop 응답 헤더가 아예 없었던 요청에만 쓰이는 최후 폴백.
_FALLBACK_NAMESPACE = "default"
_FALLBACK_POD_NAME = "juice-shop-68ccbc74b4-958dh"


def enrich(source: str, payload: Dict[str, Any], event: NormalizedEvent) -> None:
    if event.source_ip:
        geo = geoip_lookup(event.source_ip)
        event.geo_country_iso_code = geo["country_iso_code"]
        event.geo_city_name = geo["city_name"]

    if source in ("was", "waf") and not event.orchestrator_resource_name:
        event.orchestrator_namespace = _FALLBACK_NAMESPACE
        event.orchestrator_resource_type = "pod"
        event.orchestrator_resource_name = _FALLBACK_POD_NAME
