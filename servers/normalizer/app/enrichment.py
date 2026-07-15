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
# 예전엔 특정 시점에 관측된 pod 이름을 그대로 박아뒀다("juice-shop-68ccbc74b4-958dh")
# - ReplicaSet/pod 해시 접미사는 재배포·레플리카 증설마다 바뀌므로, 시간이 지나면
# 존재한 적도 없는 pod를 가리키는 값이 된다(2026-07-15, 지속 배포 환경에서 포렌식
# 조회 시 오해를 유발). 재배포에도 안정적인 event.target_name(WAS/WAF 센서의
# TARGET_NAME env var)을 대신 쓰고, 그마저 없으면 실재하지 않는 pod 이름을 지어내는
# 대신 "unknown"으로 명시한다. resource_type도 "pod"라고 단정하지 않는다 - 이 값은
# 실제 pod에서 온 게 아니라 폴백이라는 사실 자체를 나타낸다.
_FALLBACK_NAMESPACE = "default"
_FALLBACK_RESOURCE_NAME = "unknown"


def enrich(source: str, payload: Dict[str, Any], event: NormalizedEvent) -> None:
    if event.source_ip:
        geo = geoip_lookup(event.source_ip)
        event.geo_country_iso_code = geo["country_iso_code"]
        event.geo_city_name = geo["city_name"]

    if source in ("was", "waf") and not event.orchestrator_resource_name:
        event.orchestrator_namespace = _FALLBACK_NAMESPACE
        event.orchestrator_resource_type = "unknown"
        event.orchestrator_resource_name = event.target_name or _FALLBACK_RESOURCE_NAME
