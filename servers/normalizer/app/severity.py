"""severity.yaml 로드 + 소스별 심각도 계산 (P3-5)."""
from pathlib import Path
from typing import Any, Dict, Optional

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


def _match_value(expected: Any, actual: Optional[str]) -> bool:
    if isinstance(expected, list):
        return actual in expected
    return expected == actual


def get_severity(source: str, payload: Dict[str, Any]) -> int:
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

        for rule in rules.get("rules", []):
            match = rule.get("match", {})
            if "verb" in match and not _match_value(match["verb"], verb):
                continue
            if "resource" in match and not _match_value(match["resource"], resource):
                continue
            if "subresource" in match and not _match_value(match["subresource"], subresource):
                continue
            return rule.get("severity", rules.get("default", 2))
        return rules.get("default", 2)

    return 1
