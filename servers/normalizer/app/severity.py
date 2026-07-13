"""severity.yaml 로드 + 소스별 심각도 계산 (P3-5)."""
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

from app.config import settings

_RULES: Dict[str, Any] = {}


def _load() -> Dict[str, Any]:
    global _RULES
    path = Path(settings.severity_config_path)
    if not path.is_absolute():
        path = Path(__file__).resolve().parent / path
    with open(path, "r", encoding="utf-8") as f:
        _RULES = yaml.safe_load(f) or {}
    return _RULES


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


def get_severity(
    source: str, payload: Dict[str, Any], audit_flags: Optional[Dict[str, Any]] = None
) -> int:
    rules = _RULES.get(source, {})

    if source == "was":
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
            return rule.get("severity", rules.get("default", 2))
        return rules.get("default", 2)

    return 1
