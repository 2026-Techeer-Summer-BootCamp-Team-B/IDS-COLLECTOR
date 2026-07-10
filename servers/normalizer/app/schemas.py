from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class NormalizedEvent(BaseModel):
    """
    ECS(Elastic Common Schema) 서브셋 - 필드명은 전부 점 표기(`event.module` 등),
    언더스코어 표기는 쓰지 않는다. 해당 없는 필드는 null이 아니라 생략한다
    (emit 시 exclude_none=True, app/main.py 참고).

    이 워커는 OpenSearch를 직접 만지지 않는다 - Data Prepper가 events.normalized를
    구독해서 attack-logs-* 일 단위 인덱스에 _id=event.id(dedupe 키)로 색인한다 (P6-4).
    """

    # 공통 코어
    timestamp: datetime = Field(alias="@timestamp")  # 사건 실제 발생 시각(UTC)
    event_ingested: datetime = Field(alias="event.ingested")  # 파이프라인 수신 시각(UTC)
    event_id: str = Field(alias="event.id")  # dedupe 키 (was/waf/falco=해시, audit=auditID)
    event_module: Literal["was", "waf", "falco", "k8s_audit"] = Field(alias="event.module")
    event_dataset: str = Field(alias="event.dataset")  # 예: "was.access", "waf.alert"
    event_kind: str = Field(default="event", alias="event.kind")
    event_action: Optional[str] = Field(default=None, alias="event.action")
    event_outcome: Optional[str] = Field(default=None, alias="event.outcome")
    event_severity: int = Field(default=1, alias="event.severity")  # 1~4, severity.yaml 기준
    event_duration: Optional[int] = Field(default=None, alias="event.duration")  # 나노초
    event_original: str = Field(alias="event.original")  # 원본 payload JSON 문자열

    # 매칭된 룰
    rule_id: Optional[str] = Field(default=None, alias="rule.id")
    rule_name: Optional[str] = Field(default=None, alias="rule.name")

    # 상관 키 (P4 시나리오 join_on 대상 - 반드시 이 필드명으로 통일)
    source_ip: Optional[str] = Field(default=None, alias="source.ip")  # S4 join_on
    user_name: Optional[str] = Field(default=None, alias="user.name")  # S2 join_on
    orchestrator_namespace: Optional[str] = Field(default=None, alias="orchestrator.namespace")
    orchestrator_resource_type: Optional[str] = Field(
        default=None, alias="orchestrator.resource.type"
    )
    orchestrator_resource_name: Optional[str] = Field(
        default=None, alias="orchestrator.resource.name"
    )  # S1 join_on (pod)

    # HTTP / 컨테이너 컨텍스트 (WAS/WAF)
    container_name: Optional[str] = Field(default=None, alias="container.name")
    http_request_method: Optional[str] = Field(default=None, alias="http.request.method")
    url_path: Optional[str] = Field(default=None, alias="url.path")
    url_query: Optional[str] = Field(default=None, alias="url.query")
    http_request_referrer: Optional[str] = Field(default=None, alias="http.request.referrer")
    http_response_status_code: Optional[int] = Field(
        default=None, alias="http.response.status_code"
    )
    http_response_body_bytes: Optional[int] = Field(
        default=None, alias="http.response.body.bytes"
    )
    user_agent_original: Optional[str] = Field(default=None, alias="user_agent.original")

    # WAF (WafAlert 센서 스펙)
    waf_risk_level: Optional[str] = Field(default=None, alias="waf.risk_level")
    waf_payload_snippet: Optional[str] = Field(default=None, alias="waf.payload_snippet")
    waf_blocked: Optional[bool] = Field(default=None, alias="waf.blocked")
    waf_mode: Optional[str] = Field(default=None, alias="waf.mode")

    # Falco (프로세스/컨테이너 컨텍스트)
    process_name: Optional[str] = Field(default=None, alias="process.name")
    process_command_line: Optional[str] = Field(default=None, alias="process.command_line")
    process_parent_name: Optional[str] = Field(default=None, alias="process.parent.name")
    container_id: Optional[str] = Field(default=None, alias="container.id")
    container_image_name: Optional[str] = Field(default=None, alias="container.image.name")
    falco_priority: Optional[str] = Field(default=None, alias="falco.priority")
    falco_tags: Optional[List[str]] = Field(default=None, alias="falco.tags")

    # K8s Audit
    audit_stage: Optional[str] = Field(default=None, alias="kubernetes.audit.stage")
    audit_verb: Optional[str] = Field(default=None, alias="kubernetes.audit.verb")
    audit_user_groups: Optional[List[str]] = Field(
        default=None, alias="kubernetes.audit.user.groups"
    )

    # GeoIP enrichment (P3-6)
    geo_country_iso_code: Optional[str] = Field(
        default=None, alias="source.geo.country_iso_code"
    )
    geo_city_name: Optional[str] = Field(default=None, alias="source.geo.city_name")

    class Config:
        populate_by_name = True
