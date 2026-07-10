"""
Kafka에서 꺼낸 로그 payload(dict)를 공통 스키마(AttackLog)로 변환하는 모듈.

source 값은 mysite(Target 서버) otel-collector가 실제로 태깅하는 resource
attribute `log.source` 값을 그대로 따른다: "was" / "falco" / "k8s-audit"
(하이픈). AttackLog.event_module에는 기존 스키마 표기에 맞춰 "k8s_audit"
(언더스코어)로 저장한다 - wire 값과 저장 값 표기가 다른 건 실수가 아니라
"들어오는 키(mysite 쪽 관례)"와 "저장하는 값(우리 스키마 관례)"이 서로 다르기
때문. 헷갈리면 항상 이 주석 기준으로 판단할 것.

심각도(event.severity) 기준 = 설계 시트 "심각도매핑":
  - WAS raw:   판단 없음 -> 1 고정. HTTP 계층의 '판단(alert)'은 WAF 센서의 역할,
               raw access log는 맥락/통계/포렌식용으로만 흐름.
               (수정 전의 status 코드 휴리스틱(401/403->3 등)은 WAF 몫의 판단이 WAS 자리에 들어온 것이라 제거)
  - Falco:     공식 priority 직접 매핑.
               DEBUG~NOTICE -> 1 / WARNING -> 2 / ERROR, CRITICAL -> 3 / ALERT, EMERGENCY -> 4
  - K8s Audit: verb + resource 매핑. 첫 매치 우선, default 2.
"""
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from app.schemas import AttackLog


# ---------------------------------------------------------------------------
# WAS (nginx raw access log)
# ---------------------------------------------------------------------------

def normalize_was(payload: Dict[str, Any]) -> AttackLog:
    """Nginx access log(JSON) 한 줄을 AttackLog로 변환."""
    status = payload.get("status")

    return AttackLog(
        **{
            "@timestamp": payload.get("time") or datetime.now(timezone.utc).isoformat(),
            # TODO(event.id): 시트 기준은 UUID 폐기 -> 원본 라인 해시 (dedupe 키 겸 OpenSearch _id). 해시 전환 작업 때 일괄 교체 예정.
            "event_id": str(uuid.uuid4()),
            "event_module": "was",
            "event_kind": "event",
            # 시트 기준 WAS의 event.action = HTTP method. path는 url_path 필드에 이미
            # 별도로 들어가므로 여기에 중복으로 붙이지 않는다.
            "event_action": payload.get("method"),
            "event_outcome": "success" if (status and status < 400) else "failure",
            # raw 로그는 판단 없음 -> 1 고정 (심각도매핑 시트)
            "event_severity": 1,
            "event_original": json.dumps(payload, ensure_ascii=False),
            "source_ip": payload.get("remote_addr"),
            "http_request_method": payload.get("method"),
            "url_path": payload.get("path"),
            "http_response_status_code": status,
            "user_agent_original": payload.get("user_agent"),
        }
    )


# ---------------------------------------------------------------------------
# Falco
# ---------------------------------------------------------------------------

# Falco 공식 priority -> 1~4. 심각도매핑 시트 그대로:
#   1: DEBUG ~ NOTICE (Informational 포함) / 2: WARNING / 3: ERROR, CRITICAL / 4: ALERT, EMERGENCY
_FALCO_PRIORITY_SEVERITY = {
    "Emergency": 4,
    "Alert": 4,
    "Critical": 3,
    "Error": 3,
    "Warning": 2,
    "Notice": 1,
    "Informational": 1,
    "Debug": 1,
}

# 시트에 Falco의 default(미매치)는 정의돼 있지 않음. priority가 아예 없거나 모르는
# 값인 alert를 low(1)로 떨어뜨리면 이상 신호가 묻힐 수 있어서 일단 2(medium)로 둠.
# 나중에 시트에 default 행이 추가되면 그 값으로 교체하면 되지만, 아마 수정 안 해도 괜찮을 듯
_FALCO_DEFAULT_SEVERITY = 2


def normalize_falco(payload: Dict[str, Any]) -> AttackLog:
    """Falco json_output 한 줄을 AttackLog로 변환.

    output_fields는 Falco 룰의 output_fields 설정에 따라 키가 달라질 수 있어서,
    자주 쓰이는 키들(k8s.ns.name/k8s.pod.name/user.name/fd.*ip) 위주로만 우선 매핑.
    """
    output_fields = payload.get("output_fields") or {}

    return AttackLog(
        **{
            "@timestamp": payload.get("time") or datetime.now(timezone.utc).isoformat(),
            # TODO(event.id): UUID -> 원본 해시 전환 예정 (WAS 쪽 참고)
            "event_id": str(uuid.uuid4()),
            "event_module": "falco",
            "event_kind": "alert",
            "event_action": payload.get("rule"),
            # 이벤트스키마 시트 기준 Falco의 event.outcome은 "-" (해당 없음).
            # "해당 없는 필드는 null이 아니라 생략" 원칙에 따라 채우지 않는다.
            # (탐지 alert에 성공/실패 개념을 억지로 부여하지 않음)
            "event_severity": _FALCO_PRIORITY_SEVERITY.get(
                payload.get("priority"), _FALCO_DEFAULT_SEVERITY
            ),
            "event_original": json.dumps(payload, ensure_ascii=False),
            "source_ip": output_fields.get("fd.rip") or output_fields.get("fd.sip"),
            "user_name": output_fields.get("user.name"),
            "orchestrator_namespace": output_fields.get("k8s.ns.name"),
            "orchestrator_resource_name": output_fields.get("k8s.pod.name"),
        }
    )


# ---------------------------------------------------------------------------
# K8s Audit
# ---------------------------------------------------------------------------

_RBAC_RESOURCES = {"clusterroles", "clusterrolebindings", "roles", "rolebindings"}


def _severity_k8s_audit(verb: str, resource: str, subresource: str) -> int:
    """심각도매핑 시트의 audit 열(verb+resource) 그대로. 첫 매치 우선, default 2.

    (예전의 audit level(RequestResponse 등) 기반 매핑은 폐기 - level은 '얼마나
    자세히 기록할지'이지 '얼마나 위험한지'가 아니어서, 그 방식으론 RBAC 변경 같은
    severity 4가 영영 안 나온다.)
    """
    # 4 critical: RBAC 변경 = 권한상승의 정점 (S3 stage1 재료)
    if verb in ("create", "patch") and resource in _RBAC_RESOURCES:
        return 4

    # 3 high: 자격증명 탈취 (S2 재료)
    if verb in ("get", "list") and resource == "secrets":
        return 3
    # 3 high: 실행 중 컨테이너 진입 (S3 stage2 재료)
    if verb == "create" and resource == "pods" and subresource in ("exec", "attach"):
        return 3
    # 3 high: SA 토큰 발급
    if verb == "create" and resource == "serviceaccounts" and subresource == "token":
        return 3
    # 3 high: 흔적 삭제·파괴. 시트의 "대량 delete"에서 '대량' 판정은 단건 정규화
    # 단계에선 불가능하므로 delete 단건도 일단 3으로 둔다. '대량' 집계 판정은
    # 상관 엔진(threshold) 몫.
    if verb == "delete" and resource in ("pods", "deployments"):
        return 3

    # 2 medium: 워크로드 변경 맥락
    if verb in ("create", "update", "patch") and resource in ("pods", "deployments"):
        return 2

    # 1 low: (수집 시) 일반 조회
    if verb in ("get", "list", "watch"):
        return 1

    # default (미매치)
    return 2


def normalize_k8s_audit(payload: Dict[str, Any]) -> AttackLog:
    """kube-apiserver audit 로그(audit.k8s.io/v1 Event JSON) 한 줄을 AttackLog로 변환."""
    user = payload.get("user") or {}
    object_ref = payload.get("objectRef") or {}
    response_status = payload.get("responseStatus") or {}
    source_ips = payload.get("sourceIPs") or []
    status_code = response_status.get("code")

    verb = payload.get("verb", "") or ""
    resource = object_ref.get("resource", "") or ""
    subresource = object_ref.get("subresource", "") or ""

    # event.action에는 subresource까지 붙여서 "create pods/exec"처럼 남긴다.
    # (verb+resource가 심각도 판정 기준인 만큼, 사람이 볼 때도 같은 좌표계로 보이게)
    resource_full = f"{resource}/{subresource}" if subresource else resource

    return AttackLog(
        **{
            "@timestamp": payload.get("stageTimestamp")
            or payload.get("requestReceivedTimestamp")
            or datetime.now(timezone.utc).isoformat(),
            # audit은 시트 기준 그대로 auditID = event.id (dedupe 키)
            "event_id": payload.get("auditID") or str(uuid.uuid4()),
            "event_module": "k8s_audit",
            "event_kind": "event",
            "event_action": f"{verb} {resource_full}".strip(),
            "event_outcome": "success" if (status_code and status_code < 400) else "failure",
            "event_severity": _severity_k8s_audit(verb, resource, subresource),
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