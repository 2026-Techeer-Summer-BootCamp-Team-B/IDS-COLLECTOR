"""servers/normalizer/app/schemas.py의 NormalizedEvent와 동일한 필드 구조.

두 서비스가 별도 컨테이너/이미지라 지금은 그대로 복제해서 쓴다 - 필드를 바꿀 땐
반드시 양쪽을 같이 고칠 것 (나중에 서비스가 늘어나면 공유 패키지로 뽑는 걸 고려).
"""
from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class NormalizedEvent(BaseModel):
    timestamp: datetime = Field(alias="@timestamp")
    event_ingested: datetime = Field(alias="event.ingested")
    event_id: str = Field(alias="event.id")
    event_module: Literal["was", "waf", "falco", "k8s_audit"] = Field(alias="event.module")
    event_dataset: str = Field(alias="event.dataset")
    event_kind: str = Field(default="event", alias="event.kind")
    event_action: Optional[str] = Field(default=None, alias="event.action")
    event_outcome: Optional[str] = Field(default=None, alias="event.outcome")
    event_severity: int = Field(default=1, alias="event.severity")
    event_duration: Optional[int] = Field(default=None, alias="event.duration")
    event_original: str = Field(alias="event.original")

    rule_id: Optional[str] = Field(default=None, alias="rule.id")
    rule_name: Optional[str] = Field(default=None, alias="rule.name")

    source_ip: Optional[str] = Field(default=None, alias="source.ip")
    user_name: Optional[str] = Field(default=None, alias="user.name")
    orchestrator_namespace: Optional[str] = Field(default=None, alias="orchestrator.namespace")
    orchestrator_resource_type: Optional[str] = Field(
        default=None, alias="orchestrator.resource.type"
    )
    orchestrator_resource_name: Optional[str] = Field(
        default=None, alias="orchestrator.resource.name"
    )

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

    waf_risk_level: Optional[str] = Field(default=None, alias="waf.risk_level")
    waf_payload_snippet: Optional[str] = Field(default=None, alias="waf.payload_snippet")
    waf_blocked: Optional[bool] = Field(default=None, alias="waf.blocked")
    waf_mode: Optional[str] = Field(default=None, alias="waf.mode")

    process_name: Optional[str] = Field(default=None, alias="process.name")
    process_command_line: Optional[str] = Field(default=None, alias="process.command_line")
    process_parent_name: Optional[str] = Field(default=None, alias="process.parent.name")
    container_id: Optional[str] = Field(default=None, alias="container.id")
    container_image_name: Optional[str] = Field(default=None, alias="container.image.name")
    falco_priority: Optional[str] = Field(default=None, alias="falco.priority")
    falco_tags: Optional[List[str]] = Field(default=None, alias="falco.tags")

    audit_stage: Optional[str] = Field(default=None, alias="kubernetes.audit.stage")
    audit_verb: Optional[str] = Field(default=None, alias="kubernetes.audit.verb")
    audit_user_groups: Optional[List[str]] = Field(
        default=None, alias="kubernetes.audit.user.groups"
    )

    geo_country_iso_code: Optional[str] = Field(
        default=None, alias="source.geo.country_iso_code"
    )
    geo_city_name: Optional[str] = Field(default=None, alias="source.geo.city_name")

    class Config:
        populate_by_name = True
