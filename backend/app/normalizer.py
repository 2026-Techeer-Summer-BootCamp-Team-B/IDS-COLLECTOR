"""
Kafka에서 꺼낸 로그 payload(dict)를 공통 스키마(AttackLog)로 변환하는 모듈.

source 값은 mysite(Target 서버) otel-collector가 실제로 태깅하는 resource
attribute `log.source` 값을 그대로 따른다: "was" / "falco" / "k8s-audit"
(하이픈). AttackLog.event_module에는 기존 스키마 표기에 맞춰 "k8s_audit"
(언더스코어)로 저장한다 - wire 값과 저장 값 표기가 다른 건 실수가 아니라
"들어오는 키(mysite 쪽 관례)"와 "저장하는 값(우리 스키마 관례)"이 서로 다르기
때문. 헷갈리면 항상 이 주석 기준으로 판단할 것.
"""
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from app.schemas import AttackLog


def _severity_from_status(status: Optional[int]) -> int:
    """
    HTTP 상태 코드를 기준으로 한 아주 단순한 심각도 추정.
    ⚠️ 이건 임시 휴리스틱이다 - 실제 "공격인지 아닌지"를 판단하는 게 아니라
    "일단 심각도 필드를 채워두는" 용도. 나중에 상관분석/시그니처 판단 로직으로
    교체되어야 한다 (팀 문서의 "심각도 매핑" 시트가 최종 기준).
    """
    if status is None:
        return 1
    if status in (401, 403):
        return 3  # 인증/인가 실패는 눈여겨봐야 할 신호
    if status >= 500:
        return 2
    if status >= 400:
        return 2
    return 1


def normalize_was(payload: Dict[str, Any]) -> AttackLog:
    """Nginx access log(JSON) 한 줄을 AttackLog로 변환."""
    status = payload.get("status")

    return AttackLog(
        **{
            "@timestamp": payload.get("time") or datetime.now(timezone.utc).isoformat(),
            "event_id": str(uuid.uuid4()),
            "event_module": "was",
            "event_kind": "event",
            "event_action": f'{payload.get("method", "")} {payload.get("path", "")}'.strip(),
            "event_outcome": "success" if (status and status < 400) else "failure",
            "event_severity": _severity_from_status(status),
            "event_original": json.dumps(payload, ensure_ascii=False),
            "source_ip": payload.get("remote_addr"),
            "http_request_method": payload.get("method"),
            "url_path": payload.get("path"),
            "http_response_status_code": status,
            "user_agent_original": payload.get("user_agent"),
        }
    )


# Falco priority(문자열) -> 1(low)~4(critical) 심각도 매핑.
# ⚠️ 이것도 was 쪽과 마찬가지로 임시 휴리스틱. 나중에 심각도 매핑 시트 기준으로 교체.
_FALCO_PRIORITY_SEVERITY = {
    "Emergency": 4,
    "Alert": 4,
    "Critical": 4,
    "Error": 3,
    "Warning": 3,
    "Notice": 2,
    "Informational": 1,
    "Debug": 1,
}


def normalize_falco(payload: Dict[str, Any]) -> AttackLog:
    """Falco json_output 한 줄을 AttackLog로 변환.

    output_fields는 Falco 룰의 output_fields 설정에 따라 키가 달라질 수 있어서,
    자주 쓰이는 키들(k8s.ns.name/k8s.pod.name/user.name/fd.*ip) 위주로만 우선 매핑.
    """
    output_fields = payload.get("output_fields") or {}

    return AttackLog(
        **{
            "@timestamp": payload.get("time") or datetime.now(timezone.utc).isoformat(),
            "event_id": str(uuid.uuid4()),
            "event_module": "falco",
            "event_kind": "alert",
            "event_action": payload.get("rule"),
            # Falco는 "차단"이 아니라 "탐지"만 하므로, 로그가 남았다는 것 자체가
            # 이미 이상 행위가 발생했다는 뜻 -> outcome은 항상 실패(failure)로 취급.
            "event_outcome": "failure",
            "event_severity": _FALCO_PRIORITY_SEVERITY.get(payload.get("priority"), 2),
            "event_original": json.dumps(payload, ensure_ascii=False),
            "source_ip": output_fields.get("fd.rip") or output_fields.get("fd.sip"),
            "user_name": output_fields.get("user.name"),
            "orchestrator_namespace": output_fields.get("k8s.ns.name"),
            "orchestrator_resource_name": output_fields.get("k8s.pod.name"),
        }
    )


# K8s Audit level(문자열) -> 1(low)~4(critical) 심각도 매핑.
# k3d-audit-policy.yaml 기준으로 RequestResponse 레벨(RBAC 변경 등)이 가장 민감하다.
_K8S_AUDIT_LEVEL_SEVERITY = {
    "RequestResponse": 3,
    "Request": 2,
    "Metadata": 2,
    "None": 1,
}


def normalize_k8s_audit(payload: Dict[str, Any]) -> AttackLog:
    """kube-apiserver audit 로그(audit.k8s.io/v1 Event JSON) 한 줄을 AttackLog로 변환."""
    user = payload.get("user") or {}
    object_ref = payload.get("objectRef") or {}
    response_status = payload.get("responseStatus") or {}
    source_ips = payload.get("sourceIPs") or []
    status_code = response_status.get("code")

    verb = payload.get("verb", "")
    resource = object_ref.get("resource", "")

    return AttackLog(
        **{
            "@timestamp": payload.get("stageTimestamp")
            or payload.get("requestReceivedTimestamp")
            or datetime.now(timezone.utc).isoformat(),
            "event_id": payload.get("auditID") or str(uuid.uuid4()),
            "event_module": "k8s_audit",
            "event_kind": "event",
            "event_action": f"{verb} {resource}".strip(),
            "event_outcome": "success" if (status_code and status_code < 400) else "failure",
            "event_severity": _K8S_AUDIT_LEVEL_SEVERITY.get(payload.get("level"), 1),
            "event_original": json.dumps(payload, ensure_ascii=False),
            "source_ip": source_ips[0] if source_ips else None,
            "user_name": user.get("username"),
            "orchestrator_namespace": object_ref.get("namespace"),
            "orchestrator_resource_name": object_ref.get("name"),
            "http_response_status_code": status_code,
        }
    )


def normalize(source: Optional[str], payload: Dict[str, Any]) -> Optional[AttackLog]:
    """source(log.source resource attribute 값)에 따라 알맞은 정규화 함수로 라우팅."""
    if source == "was":
        return normalize_was(payload)
    if source == "falco":
        return normalize_falco(payload)
    if source == "k8s-audit":
        return normalize_k8s_audit(payload)

    return None
