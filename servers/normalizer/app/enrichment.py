"""Enrichment (P3-6): GeoIP + was/waf 정적 orchestrator 매핑(단일 타깃 전제).

GeoIP는 app/geoip.py의 더미를 그대로 쓴다 (MaxMind .mmdb 확보 후 그 파일만 교체하면 됨).
falco/audit는 자기 payload에서 orchestrator.*를 동적으로 이미 채우므로 여기서 건드리지
않는다 - was/waf는 access log/WAF alert 자체에 pod 식별 정보가 없어서 정적 값으로 채운다.
"""
from typing import Any, Dict

from app.geoip import lookup as geoip_lookup
from app.schemas import NormalizedEvent

# TODO: 단일 타깃 전제 - 실제 배포된 pod 이름이 바뀌면 여기만 교체하면 됨
# (나중엔 K8s API 조회로 대체 가능).
_TARGET_NAMESPACE = "default"
_TARGET_POD_NAME = "juice-shop-68ccbc74b4-xh7r8"


def enrich(source: str, payload: Dict[str, Any], event: NormalizedEvent) -> None:
    if event.source_ip:
        geo = geoip_lookup(event.source_ip)
        event.geo_country_iso_code = geo["country_iso_code"]
        event.geo_city_name = geo["city_name"]

    if source in ("was", "waf"):
        event.orchestrator_namespace = _TARGET_NAMESPACE
        event.orchestrator_resource_type = "pod"
        event.orchestrator_resource_name = _TARGET_POD_NAME
