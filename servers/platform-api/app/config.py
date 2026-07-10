from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    postgres_dsn: str = "postgresql://ids_admin:devpassword123@postgres:5432/ids_platform"
    redis_url: str = "redis://redis:6379/0"
    opensearch_url: str = "http://opensearch:9200"
    attack_log_index_pattern: str = "attack-logs-*"

    # 인증 (P5-2) - 스펙 미설계. Target에서 이관될 실제 역할 모델이 정해지기 전까지
    # 단일 관리자 계정 스텁으로만 동작.
    admin_username: str = "admin"
    admin_password: str = "changeme"

    # 알림 채널 (P5-3) - 비어있으면 발송 안 하고 로그만 남긴다.
    # TODO: alert_configs 테이블(app/alert_configs_api.py로 CRUD)이 이미 있으니
    # notifications.py가 이 고정 환경변수 대신 그 테이블을 읽도록 바꿀 것 (나중에 API
    # 작업 때 같이 진행 - 지금은 크래시만 막아둔 상태).
    slack_webhook_url: str = ""
    discord_webhook_url: str = ""
    critical_severity_threshold: int = 4

    # AI 트렌드 리포트 (P5-4) - 비어있으면 "미설정" 응답만 반환.
    anthropic_api_key: str = ""

    # 프론트엔드가 별도 레포/팀이라 다른 origin에서 REST/WS를 호출한다 - CORS 허용
    # origin 목록(콤마 구분). "*"면 전체 허용(개발 기본값, 쿠키/인증정보 없는
    # 토큰 방식이라 "*"라도 안전).
    cors_allowed_origins: str = "*"

    class Config:
        env_file = ".env"

    @property
    def cors_allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_allowed_origins.split(",") if o.strip()]


settings = Settings()
