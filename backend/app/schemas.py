from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class AttackLog(BaseModel):
    """
    OpenSearch에 저장되는 정규화된 이벤트. ECS(Elastic Common Schema) 서브셋 기준.
    소스(WAS/Falco/K8s Audit)가 달라도 이 스키마 하나로 통일해서 저장한다.
    """

    # 공통 코어
    timestamp: datetime = Field(alias="@timestamp")
    event_id: str
    event_module: str  # "was" / "falco" / "k8s_audit"
    event_kind: str = "event"
    event_action: Optional[str] = None
    event_outcome: Optional[str] = None
    event_severity: int = 1  # 1(low) ~ 4(critical), 심각도매핑 기준
    event_original: str  # 원본 페이로드 JSON 문자열 그대로 보관 (포렌식용)

    # 상관 키
    source_ip: Optional[str] = None
    user_name: Optional[str] = None
    orchestrator_namespace: Optional[str] = None
    orchestrator_resource_name: Optional[str] = None

    # HTTP 확장 (WAS 소스일 때만 채워짐)
    http_request_method: Optional[str] = None
    url_path: Optional[str] = None
    http_response_status_code: Optional[int] = None
    user_agent_original: Optional[str] = None

    # GeoIP enrichment
    geo_country_iso_code: Optional[str] = None
    geo_city_name: Optional[str] = None

    class Config:
        populate_by_name = True