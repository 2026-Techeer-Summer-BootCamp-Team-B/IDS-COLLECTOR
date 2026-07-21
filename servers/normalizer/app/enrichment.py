"""Enrichment (P3-6): GeoIP + was/waf orchestrator 폴백.

GeoIP는 app/geoip.py가 MaxMind GeoLite2-City(.mmdb)를 실측 조회한다(2026-07-16, geoip2fast
country-only 배포판에서 교체 - city/위경도가 필요해짐). Redis 캐시 조회가 있어 lookup()
자체는 async - 이 함수도 그래서 async다(main.py에서 await enrich(...)).

falco/audit는 자기 payload에서 orchestrator.*를 동적으로 이미 채우므로 여기서 건드리지
않는다 - was/waf도 이제 normalizer.py의 normalize_was/normalize_waf가 각각
nginx-was-logger의 Downward API 값(로그 자체에 실림)과 WAF backend가 Juice Shop
응답 헤더(X-Served-By-Pod/Namespace)에서 옮겨 담은 값으로 orchestrator.*를 동적으로
채운다 - 정적 하드코딩 아님, 재배포/레플리카 증설에도 항상 실제 값을 반영한다.

여기서는 그 값이 비어 있는 경우(예: WAF prevention 모드로 차단되어 Juice Shop 응답
자체가 없었던 요청)에 한해서만 아래 폴백을 채운다 - 폴백 값이 스테일해질 수 있다는
한계는 여전하지만, 정상 경로(대부분의 이벤트)는 이제 이 값에 의존하지 않는다.
"""
from typing import Any, Dict, Optional

from app.geoip import lookup as geoip_lookup
from ids_shared.schemas import NormalizedEvent

# target.name(WAS/WAF) 또는 pod 이름 접두사(Falco)로 "이 이벤트가 벌어진 대상 pod에
# 바인딩된 K8s 신원"을 채워 넣는다(2026-07-19, actor_identity 필드 - schemas.py 주석
# 참고). kubectl get pod -o jsonpath='{.spec.serviceAccountName}'로 실측 확인
# (juice-shop/juice-shop-2 둘 다 serviceAccountName을 따로 안 줘서 default 네임스페이스의
# default SA를 그대로 씀) - 여러 타깃을 붙이게 되면 여기에 그 타깃의 실제 SA도
# 추가할 것. Falco 쪽은 target.name이 없어서(클러스터 단위 이벤트) pod 이름 접두사로
# 대신 매칭한다 - 정확한 pod 이름 자체를 하드코딩하지 않는 이유는 위
# _FALLBACK_RESOURCE_NAME 주석과 같다(ReplicaSet 해시 접미사가 재배포마다 바뀜) -
# Deployment 이름 접두사는 재배포에도 안정적이다.
_TARGET_ACTOR_IDENTITY: Dict[str, str] = {
    "juice-shop": "system:serviceaccount:default:default",
    "juice-shop-2": "system:serviceaccount:default:default",
}
# "juice-shop-2-xxx"가 "juice-shop-"에도 접두사로 걸려버리는 걸 막기 위해 긴 이름부터
# 검사한다(정확한 이름 자체도 pod-template-hash 없이 그대로 올 수 있어 우선 비교).
_TARGET_NAMES_BY_LENGTH_DESC = sorted(_TARGET_ACTOR_IDENTITY, key=len, reverse=True)

# 매핑에 없는 타깃(신규 타깃 추가 후 이 dict 갱신을 빠뜨린 경우 등)을 이벤트마다
# 조용히 None으로 흘려보내면 WAS/WAF/Falco <-> K8s Audit RBAC 상관분석 체인이
# actor_identity 축에서 끊기는데, 아무 로그도 안 남아 아무도 못 알아챈다
# (2026-07-21). 같은 키(target_name 또는 falco pod)는 프로세스 생애주기당 한 번만
# 경고한다 - 이벤트마다 찍으면 매핑 안 된 타깃 하나가 트래픽만큼 로그를 도배한다.
_warned_missing_actor_identity: set = set()


def _warn_missing_actor_identity_once(key: str, detail: str) -> None:
    if key in _warned_missing_actor_identity:
        return
    _warned_missing_actor_identity.add(key)
    print(
        f"[normalizer] WARNING: actor_identity 매핑 없음 ({detail}) - 이 대상에서 온 "
        "이벤트는 K8s Audit RBAC 상관분석 체인(actor_identity 기준)에 안 묶입니다. "
        "app/enrichment.py의 _TARGET_ACTOR_IDENTITY에 추가하세요."
    )


def _actor_identity_for_pod(pod_name: Optional[str]) -> Optional[str]:
    if not pod_name:
        return None
    for name in _TARGET_NAMES_BY_LENGTH_DESC:
        if pod_name == name or pod_name.startswith(f"{name}-"):
            return _TARGET_ACTOR_IDENTITY[name]
    _warn_missing_actor_identity_once(f"falco-pod:{pod_name}", f"falco pod={pod_name!r}")
    return None


def _actor_identity_for_target(target_name: Optional[str]) -> Optional[str]:
    """WAS/WAF 경로 - _actor_identity_for_pod와 대칭되는 순수 함수(비동기 enrich()
    밖으로 뺀 이유는 Kafka/Redis 없이 단위 테스트하기 위함, tests/test_enrichment.py
    참고). target_name이 아예 없는 경우(센서 미설정 등, 별개 문제)는 경고하지
    않고, "값은 있는데 매핑에 없는" 경우만 경고한다."""
    identity = _TARGET_ACTOR_IDENTITY.get(target_name)
    if identity is None and target_name:
        _warn_missing_actor_identity_once(f"target:{target_name}", f"target_name={target_name!r}")
    return identity


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


async def enrich(source: str, payload: Dict[str, Any], event: NormalizedEvent) -> None:
    if event.source_ip:
        geo = await geoip_lookup(event.source_ip)
        event.geo_country_iso_code = geo["country_iso_code"]
        event.geo_city_name = geo["city_name"]
        event.geo_lat = geo["lat"]
        event.geo_lon = geo["lon"]

    if source in ("was", "waf") and not event.orchestrator_resource_name:
        event.orchestrator_namespace = _FALLBACK_NAMESPACE
        event.orchestrator_resource_type = "unknown"
        event.orchestrator_resource_name = event.target_name or _FALLBACK_RESOURCE_NAME

    if source in ("was", "waf"):
        event.actor_identity = _actor_identity_for_target(event.target_name)
    elif source == "falco":
        event.actor_identity = _actor_identity_for_pod(event.orchestrator_resource_name)
