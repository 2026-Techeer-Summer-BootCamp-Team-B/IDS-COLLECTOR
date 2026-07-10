"""
Kafka에서 꺼낸 로그 payload(dict)를 공통 스키마(NormalizedEvent)로 변환하는 모듈.

source는 P2-1 토픽 분리 이후로는 Kafka 토픽 자체가 알려준다 (events.was/waf/falco/audit
-> was/waf/falco/audit - 이 내부 dispatch 값은 event.module 저장값과 다르다: audit
토픽/파서 dispatch는 "audit"를 그대로 쓰지만 저장되는 event.module 값은 "k8s_audit"다).
dedupe 키(event_id)와 원본 문자열(event_original)은 dedupe가 이미 계산해둔 뒤라
main.py에서 그대로 넘겨받는다 - 여기서 다시 계산하지 않는다.

심각도(event.severity)는 app/severity.py(severity.yaml) 참고 - 이 모듈은 값을
하드코딩하지 않고 소스별 판단에 필요한 원본 필드만 넘긴다.

orchestrator.namespace/resource.type/resource.name의 was/waf 쪽 정적 매핑(단일 타깃
전제)은 여기서 채우지 않는다 - app/enrichment.py가 담당 (falco/audit는 자기 payload로
동적으로 나오므로 여기서 채운다).
"""
from datetime import datetime, timezone
from typing import Any, Dict

from app.schemas import NormalizedEvent
from app.severity import get_severity


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _parse_timestamp(value: Any) -> datetime:
    if not value:
        return _now_utc()
    try:
        ts = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    except ValueError:
        return _now_utc()


# ---------------------------------------------------------------------------
# WAS (nginx raw access log)
# ---------------------------------------------------------------------------


def _was_source_ip(payload: Dict[str, Any]) -> Any:
    """XFF 첫 홉 우선, 없으면 remote_addr.

    TODO [Target 액션]: nginx log format에 $http_x_forwarded_for가 아직 없어서
    지금은 대부분 remote_addr로 떨어진다 - S4(join_on=source_ip) 정확도에 영향.
    """
    xff = payload.get("http_x_forwarded_for") or payload.get("x_forwarded_for")
    if xff:
        return xff.split(",")[0].strip()
    return payload.get("remote_addr")


def _was_duration_ns(payload: Dict[str, Any]) -> Any:
    request_time = payload.get("request_time")
    if request_time is None:
        return None
    try:
        return int(float(request_time) * 1_000_000_000)
    except (TypeError, ValueError):
        return None


def normalize_was(payload: Dict[str, Any], event_id: str, original: str) -> NormalizedEvent:
    """Nginx access log(JSON) 한 줄을 NormalizedEvent로 변환."""
    status = payload.get("status")

    return NormalizedEvent(
        **{
            "@timestamp": _parse_timestamp(payload.get("time")),
            "event.ingested": _now_utc(),
            "event.id": event_id,
            "event.module": "was",
            "event.dataset": "was.access",
            "event.kind": "event",
            "event.action": payload.get("method"),
            "event.outcome": "success" if (status and status < 400) else "failure",
            "event.severity": get_severity("was", payload),
            "event.duration": _was_duration_ns(payload),
            "event.original": original,
            "source.ip": _was_source_ip(payload),
            "container.name": "nginx-was-logger",
            "http.request.method": payload.get("method"),
            "url.path": payload.get("path"),
            "url.query": payload.get("query"),
            "http.request.referrer": payload.get("referrer"),
            "http.response.status_code": status,
            "http.response.body.bytes": payload.get("body_bytes_sent"),
            "user_agent.original": payload.get("user_agent"),
        }
    )


# ---------------------------------------------------------------------------
# WAF (WafAlert 센서 스펙)
# ---------------------------------------------------------------------------


def normalize_waf(payload: Dict[str, Any], event_id: str, original: str) -> NormalizedEvent:
    """WafAlert 한 건을 NormalizedEvent로 변환.

    wire 필드: attack_type / risk_level / matched_rule_id / payload_snippet /
    target_endpoint / http_method / user_agent / blocked / mode (+ client_ip).
    센서 개편으로 필드명이 바뀌면 이 파서와 본 계약 문서를 같이 갱신할 것.
    """
    return NormalizedEvent(
        **{
            "@timestamp": _parse_timestamp(payload.get("time")),
            "event.ingested": _now_utc(),
            "event.id": event_id,
            "event.module": "waf",
            "event.dataset": "waf.alert",
            "event.kind": "alert",
            "event.action": payload.get("attack_type"),
            # WAF도 falco와 마찬가지로 "탐지/차단" alert라 outcome 개념을 억지로
            # 붙이지 않는다 (해당 없는 필드는 생략).
            "event.severity": get_severity("waf", payload),
            "event.original": original,
            "rule.id": payload.get("matched_rule_id"),
            "source.ip": payload.get("client_ip"),
            "http.request.method": payload.get("http_method"),
            "url.path": payload.get("target_endpoint"),
            "user_agent.original": payload.get("user_agent"),
            "waf.risk_level": payload.get("risk_level"),
            "waf.payload_snippet": payload.get("payload_snippet"),
            "waf.blocked": payload.get("blocked"),
            "waf.mode": payload.get("mode"),
        }
    )


# ---------------------------------------------------------------------------
# Falco
# ---------------------------------------------------------------------------


def normalize_falco(payload: Dict[str, Any], event_id: str, original: str) -> NormalizedEvent:
    """Falco json_output 한 줄을 NormalizedEvent로 변환.

    output_fields는 Falco 룰의 output_fields 설정에 따라 키가 달라질 수 있어서,
    자주 쓰이는 키들(k8s.ns.name/k8s.pod.name/user.name/fd.*ip/proc.*/container.*)
    위주로만 우선 매핑.
    """
    output_fields = payload.get("output_fields") or {}

    return NormalizedEvent(
        **{
            "@timestamp": _parse_timestamp(payload.get("time")),
            "event.ingested": _now_utc(),
            "event.id": event_id,
            "event.module": "falco",
            "event.dataset": "falco.alert",
            "event.kind": "alert",
            "event.action": payload.get("rule"),
            # Falco의 event.outcome은 "-"(해당 없음) -> 생략.
            "event.severity": get_severity("falco", payload),
            "event.original": original,
            "rule.name": payload.get("rule"),
            # 네트워크 룰일 때만 채워짐 (fd.rip/fd.sip 없으면 None -> 생략).
            "source.ip": output_fields.get("fd.rip") or output_fields.get("fd.sip"),
            "user.name": output_fields.get("user.name"),
            "orchestrator.namespace": output_fields.get("k8s.ns.name"),
            "orchestrator.resource.type": "pod",
            "orchestrator.resource.name": output_fields.get("k8s.pod.name"),
            "process.name": output_fields.get("proc.name"),
            "process.command_line": output_fields.get("proc.cmdline"),
            "process.parent.name": output_fields.get("proc.pname"),
            "container.id": output_fields.get("container.id"),
            "container.image.name": output_fields.get("container.image.repository"),
            "falco.priority": payload.get("priority"),
            "falco.tags": payload.get("tags"),
        }
    )


# ---------------------------------------------------------------------------
# K8s Audit
# ---------------------------------------------------------------------------


def normalize_audit(payload: Dict[str, Any], event_id: str, original: str) -> NormalizedEvent:
    """kube-apiserver audit 로그(audit.k8s.io/v1 Event JSON) 한 줄을 NormalizedEvent로 변환.

    호출하는 쪽(main.py)에서 stage != "ResponseComplete"인 레코드는 이 함수까지
    오지 않고 이미 걸러진다 (RequestReceived 등 중간 스테이지 드롭)."""
    user = payload.get("user") or {}
    object_ref = payload.get("objectRef") or {}
    response_status = payload.get("responseStatus") or {}
    source_ips = payload.get("sourceIPs") or []
    status_code = response_status.get("code")

    verb = payload.get("verb", "") or ""
    resource = object_ref.get("resource", "") or ""
    subresource = object_ref.get("subresource", "") or ""

    # event.action에는 subresource까지 붙여서 "create pods/exec"처럼 남긴다.
    resource_full = f"{resource}/{subresource}" if subresource else resource

    return NormalizedEvent(
        **{
            "@timestamp": _parse_timestamp(
                payload.get("stageTimestamp") or payload.get("requestReceivedTimestamp")
            ),
            "event.ingested": _now_utc(),
            "event.id": event_id,
            "event.module": "k8s_audit",
            "event.dataset": "k8s_audit.audit",
            "event.kind": "event",
            "event.action": f"{verb} {resource_full}".strip(),
            "event.outcome": "success" if (status_code and status_code < 400) else "failure",
            "event.severity": get_severity("audit", payload),
            "event.original": original,
            "source.ip": source_ips[0] if source_ips else None,
            "user.name": user.get("username"),
            "orchestrator.namespace": object_ref.get("namespace"),
            "orchestrator.resource.type": resource or None,
            "orchestrator.resource.name": object_ref.get("name"),
            "kubernetes.audit.stage": payload.get("stage"),
            "kubernetes.audit.verb": verb or None,
            "kubernetes.audit.user.groups": user.get("groups"),
            "http.response.status_code": status_code,
        }
    )


_PARSERS = {
    "was": normalize_was,
    "waf": normalize_waf,
    "falco": normalize_falco,
    "audit": normalize_audit,
}


def normalize(source: str, payload: Dict[str, Any], event_id: str, original: str) -> NormalizedEvent:
    """source(Kafka 토픽에서 파생된 값)에 따라 알맞은 정규화 함수로 라우팅.

    알 수 없는 source면 ValueError를 던진다 - main.py가 이걸 parse 실패로 보고
    DLQ로 보낸다 (P3-7). 정규화 자체가 실패한 케이스(필드 누락 등)도 이 경로로 흡수된다.
    """
    parser = _PARSERS.get(source)
    if parser is None:
        raise ValueError(f"알 수 없는 소스: {source}")
    return parser(payload, event_id, original)
