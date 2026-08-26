from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """P7-1: GCP Cloud Audit Logs -> Pub/Sub -> 이 서비스 -> OTel Collector(OTLP) 경로 설정.

    전제: GCP 프로젝트에 Cloud Audit Logs를 이 subscription으로 내보내는 로그 라우터
    싱크(sink)가 이미 구성돼 있어야 한다(이 서비스는 싱크를 만들지 않는다 - GCP 콘솔/
    Terraform에서 `gcloud logging sinks create ... pubsub.googleapis.com/...` 로 별도
    구성). 서비스계정 키는 GOOGLE_APPLICATION_CREDENTIALS 표준 env var로 주입한다
    (docker-compose.yml이 파일을 read-only 볼륨 마운트).
    """

    gcp_project_id: str = "CHANGE_ME_gcp_project_id"
    # Cloud Audit Logs 싱크가 발행하는 Pub/Sub 토픽을 구독하는 pull subscription 이름.
    gcp_pubsub_subscription: str = "cloud-audit-logs-sub"

    # OTel Collector의 OTLP HTTP 리시버 - otel-config.yaml의 receivers.otlp.http와 동일
    # 엔드포인트(그 파일의 4318 포트 참고). Target 쪽 otel-collector와 달리 이 서비스는
    # 클러스터 밖 GCP API를 호출하는 별도 컨테이너라 gRPC 대신 단순한 HTTP로 보낸다.
    otlp_http_endpoint: str = "http://otel-collector:4318/v1/logs"

    # otel-config.yaml routing connector가 이 값으로 events.cloud 토픽에 라우팅한다.
    log_source_tag: str = "cloud-audit"

    class Config:
        env_file = ".env"


settings = Settings()
