"""severity.yaml 로드 + 소스별 심각도 계산 (P3-5)."""
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

from app.config import settings

_RULES: Dict[str, Any] = {}
_config_path: Optional[Path] = None
_last_mtime: Optional[float] = None


def _resolve_path() -> Path:
    global _config_path
    if _config_path is None:
        path = Path(settings.severity_config_path)
        if not path.is_absolute():
            path = Path(__file__).resolve().parent / path
        _config_path = path
    return _config_path


def _load() -> Dict[str, Any]:
    global _RULES, _last_mtime
    path = _resolve_path()
    with open(path, "r", encoding="utf-8") as f:
        _RULES = yaml.safe_load(f) or {}
    _last_mtime = path.stat().st_mtime
    return _RULES


def _reload_if_changed() -> None:
    """severity.yaml이 마지막 로드 이후 바뀌었으면 다시 읽는다 - 예전엔 모듈
    임포트 시점에 딱 한 번만 읽어서 룰을 바꾸려면 normalizer를 재배포해야 했다
    (2026-07-15). get_severity() 호출마다 stat() 하나만 더 하는 정도라(파일을
    매번 다시 파싱하는 게 아니라 바뀌었을 때만) 이벤트 처리 hot path 부담이
    거의 없다. stat 자체가 실패하면(파일이 일시적으로 없어짐 등) 기존 _RULES를
    그대로 유지한다."""
    path = _resolve_path()
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return
    if mtime != _last_mtime:
        _load()


_load()


# 인자 순서는 항상 (actual, expected) - correlation-engine/app/rules.py의 동명 함수와
# 반드시 맞출 것. 이 매칭 로직 자체는 (NormalizedEvent 스키마와 달리) shared 패키지로
# 뽑지 않고 각 서비스에 그대로 남겨뒀다 - severity.py는 raw payload(dict)를, rules.py는
# NormalizedEvent(pydantic 모델)를 검사해서 입력 형태 자체가 달라 공유해도 이득이
# 적다. 예전엔 이 파일만 (expected, actual)로 반대라 두 함수를 오가며 고칠 때 인자를
# 바꿔 넣기 쉬웠다 - 순서를 rules.py 쪽으로 통일했다.
def _match_value(actual: Optional[str], expected: Any) -> bool:
    if isinstance(expected, list):
        return actual in expected
    return actual == expected


def _match_any_flag(actual_flags: Optional[List[str]], wanted: Any) -> bool:
    """actual_flags(리스트 필드) 중 wanted에 있는 값이 하나라도 있으면 True.
    correlation-engine/app/rules.py의 _match_any_flag와 같은 규칙(인자 순서도 동일하게
    맞춤) - pod_security_flags_any/service_type이 request body에서 나온 리스트
    필드라 단일 값 매칭(_match_value)으로는 못 잡는다."""
    flags = actual_flags or []
    wanted = wanted if isinstance(wanted, list) else [wanted]
    return any(flag in flags for flag in wanted)


def _match_prefix(actual: Optional[str], prefix: str) -> bool:
    return (actual or "").startswith(prefix)


def get_severity(
    source: str, payload: Dict[str, Any], audit_flags: Optional[Dict[str, Any]] = None
) -> int:
    _reload_if_changed()
    rules = _RULES.get(source, {})

    if source == "was":
        # S19(로그인 브루트포스, correlation-engine/app/scenarios/network.yaml) 재료 -
        # 로그인 실패 이벤트만 audit와 같은 rules 매칭 방식으로 severity를 올린다
        # (전체 트래픽과 구분 안 되는 기본값 1로 묻히면 개별 이벤트 조회/필터에서
        # 안 보임 - threshold 상관분석 자체는 severity와 무관하게 동작하지만, 그
        # "재료"가 된 이벤트도 심각도로는 구분 가능해야 한다).
        path = payload.get("path") or ""
        method = payload.get("method")
        status = payload.get("status")
        for rule in rules.get("rules", []):
            match = rule.get("match", {})
            if "path_prefix" in match and not _match_prefix(path, match["path_prefix"]):
                continue
            if "method" in match and not _match_value(method, match["method"]):
                continue
            if "status" in match and not _match_value(status, match["status"]):
                continue
            return rule.get("severity", rules.get("default", 1))
        return rules.get("default", 1)

    if source == "waf":
        risk_level = payload.get("risk_level")
        return rules.get("risk_level", {}).get(risk_level, rules.get("default", 2))

    if source == "falco":
        priority = payload.get("priority")
        return rules.get("priority", {}).get(priority, rules.get("default", 2))

    if source == "audit":
        verb = payload.get("verb") or ""
        object_ref = payload.get("objectRef") or {}
        resource = object_ref.get("resource") or ""
        subresource = object_ref.get("subresource") or ""
        namespace = object_ref.get("namespace") or ""

        audit_flags = audit_flags or {}
        pod_security_flags = audit_flags.get("pod_security_flags")
        service_type = audit_flags.get("service_type")
        configmap_has_credentials = bool(audit_flags.get("configmap_has_credentials"))
        ingress_has_tls = audit_flags.get("ingress_has_tls")

        for rule in rules.get("rules", []):
            match = rule.get("match", {})
            if "verb" in match and not _match_value(verb, match["verb"]):
                continue
            if "resource" in match and not _match_value(resource, match["resource"]):
                continue
            if "subresource" in match and not _match_value(subresource, match["subresource"]):
                continue
            if "namespace" in match and not _match_value(namespace, match["namespace"]):
                continue
            if "pod_security_flags_any" in match and not _match_any_flag(
                pod_security_flags, match["pod_security_flags_any"]
            ):
                continue
            if "service_type" in match and not _match_any_flag(service_type, match["service_type"]):
                continue
            if (
                "configmap_has_credentials" in match
                and match["configmap_has_credentials"] != configmap_has_credentials
            ):
                continue
            # ingress_has_tls는 configmap_has_credentials와 달리 3값(True/False/None,
            # None=요청 본문을 못 받아 판정 불가)이라 bool()로 뭉개지 않고 그대로 비교한다
            # - None을 False로 뭉개면 판정 불가 케이스가 "TLS 없음"으로 오탐된다.
            if "ingress_has_tls" in match and match["ingress_has_tls"] != ingress_has_tls:
                continue
            return rule.get("severity", rules.get("default", 2))
        return rules.get("default", 2)

    return 1
