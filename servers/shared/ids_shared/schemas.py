from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class NormalizedEvent(BaseModel):
    """
    ECS(Elastic Common Schema) 서브셋 - 필드명은 전부 점 표기(`event.module` 등),
    언더스코어 표기는 쓰지 않는다. 해당 없는 필드는 null이 아니라 생략한다
    (emit 시 exclude_none=True, normalizer/app/main.py 참고).

    normalizer(정규화 -> events.normalized 발행)와 correlation-engine(그 토픽을
    구독해서 시나리오 평가)이 공유하는 유일한 스키마 정의 - 두 서비스가 이 계약을
    한 글자도 다르지 않게 봐야 하므로 여기 하나로만 둔다. 예전엔 각 서비스 app/
    밑에 수동으로 복제한 사본을 뒀는데("두 서비스가 별도 컨테이너/이미지라 지금은
    그대로 복제해서 쓴다"), 원본(normalizer)만 수정되고 사본(correlation-engine)이
    동기화되지 않아 여기 없는 필드(audit_role_rule_flags 등)에 접근할 때
    AttributeError가 나서 correlation-engine의 evaluate()가 그 이벤트에서 통째로
    죽는 사고가 있었다 - 이 패키지로 뽑아서 구조적으로 재발을 막는다.

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
    # was/waf/falco 이벤트에 enrichment.py가 채워 넣는 "이 이벤트가 벌어진 대상 pod에
    # 바인딩된 K8s 신원"(2026-07-19, join_on=user_or_sa로 WAF/Falco를 k8s_audit까지
    # 한 체인으로 잇기 위해 도입). user_name과 분리한 이유 - falco는 이미 user_name에
    # 컨테이너 안 OS 유저(root 등, 포렌식 가치가 있는 별개 정보)를 채우고 있어서 같은
    # 필드에 K8s 신원을 덮어쓰면 그 정보가 사라진다. rules.py의 _join_key()가
    # user_or_sa 조인 시 이 필드를 user_name보다 우선 사용한다(둘 다 있을 이벤트는
    # 없음 - k8s_audit은 이 필드를 안 채우고 user_name만 채움).
    actor_identity: Optional[str] = Field(default=None, alias="actor.identity")
    orchestrator_namespace: Optional[str] = Field(default=None, alias="orchestrator.namespace")
    orchestrator_resource_type: Optional[str] = Field(
        default=None, alias="orchestrator.resource.type"
    )
    orchestrator_resource_name: Optional[str] = Field(
        default=None, alias="orchestrator.resource.name"
    )  # S1 join_on (pod)
    # was/waf 전용 - 이 이벤트가 어느 보호 대상 앱(targets 테이블의 name) 소속인지.
    # Falco/k8s_audit은 앱 단위가 아니라 클러스터 단위 이벤트라 이 필드를 안 채운다.
    # allow_list의 target_id 스코프 집행이 이 값으로 이뤄진다(correlation-engine/
    # app/rules.py 참고).
    target_name: Optional[str] = Field(default=None, alias="target.name")

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

    # K8s Audit - RBAC request body 분석. k3d-audit-policy.yaml이 roles/clusterroles/
    # rolebindings/clusterrolebindings의 create/update/patch/delete를 RequestResponse
    # 레벨로 남겨서 requestObject를 실제로 받을 수 있다. 그 외 리소스는 Metadata
    # 레벨이라 requestObject 자체가 안 온다 - pods의 create만 예외(바로 아래 필드,
    # 2026-07-12에 Request 레벨로 승격함).
    audit_role_rule_flags: Optional[List[str]] = Field(
        default=None, alias="kubernetes.audit.role.rule_flags"
    )  # role/clusterrole의 rules 분석 결과: wildcard_resource/wildcard_verb/write_verb/pods_exec
    audit_binding_role_name: Optional[List[str]] = Field(
        default=None, alias="kubernetes.audit.binding.role_name"
    )  # rolebinding/clusterrolebinding이 가리키는 roleRef.name (requestObject가 JSON
    # Patch 배열이면 배열 안 여러 원소의 이름이 나올 수 있어 리스트로 합친다)

    # K8s Audit - Pod 생성 request body 분석 (2026-07-12, k3d-audit-policy.yaml이
    # pods의 create만 Request 레벨로 승격한 뒤 가능해짐). 생성 이후 바뀔 수 없는
    # 불변 필드들이라 create 시점 한 번만 보면 충분하다.
    audit_pod_security_flags: Optional[List[str]] = Field(
        default=None, alias="kubernetes.audit.pod.security_flags"
    )  # privileged/host_network/host_pid/host_ipc/host_path_volume 중 있는 것만

    # K8s Audit - Service/ConfigMap request body 분석 (2026-07-12, k3d-audit-policy.yaml이
    # services/configmaps의 create·update·patch를 Request 레벨로 승격한 뒤 가능해짐).
    audit_service_type: Optional[List[str]] = Field(
        default=None, alias="kubernetes.audit.service.type"
    )  # spec.type (ClusterIP/NodePort/LoadBalancer/ExternalName) - requestObject가
    # JSON Patch 배열이면 배열 안 여러 원소의 타입이 나올 수 있어 리스트로 합친다
    audit_configmap_has_credentials: Optional[bool] = Field(
        default=None, alias="kubernetes.audit.configmap.has_credentials"
    )  # data/binaryData에 aws_access_key_id/password/passphrase류 문자열이 있는지

    # K8s Audit - Ingress request body 분석 (2026-07-14, k3d-audit-policy.yaml이
    # networking.k8s.io/ingresses의 create를 Request 레벨로 승격한 뒤 가능해짐. S24 재료).
    audit_ingress_has_tls: Optional[bool] = Field(
        default=None, alias="kubernetes.audit.ingress.has_tls"
    )  # spec.tls 키 존재 여부(falcosecurity/plugins의 ingress_tls 매크로와 동일 판정 -
    # 값이 비어있는 배열이어도 "존재"로 친다)

    # GeoIP enrichment (P3-6)
    geo_country_iso_code: Optional[str] = Field(
        default=None, alias="source.geo.country_iso_code"
    )
    geo_city_name: Optional[str] = Field(default=None, alias="source.geo.city_name")
    geo_lat: Optional[float] = Field(default=None, alias="source.geo.location.lat")
    geo_lon: Optional[float] = Field(default=None, alias="source.geo.location.lon")

    class Config:
        populate_by_name = True

    @property
    def event_date(self) -> str:
        """timestamp(사건 실제 발생 시각, UTC)의 날짜 부분만 "YYYY-MM-DD" 문자열로
        뽑은 순수 파생 값(2026-07-20, 여러 계층 시나리오 Notion 페이지의 M52 -
        correlation-engine의 cardinality distinct_field로 "서로 다른 며칠에 걸쳐
        발생했는지"를 세는 용도). Kafka로 직렬화되는 실제 필드가 아니다 - normalizer가
        만들 때나 correlation-engine이 평가할 때나 각자 이미 가진 timestamp에서 그때그때
        계산하므로, event.original 페이로드나 와이어 포맷을 전혀 바꾸지 않고
        추가할 수 있었다."""
        return self.timestamp.date().isoformat()
