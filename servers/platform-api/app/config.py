from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    postgres_dsn: str = "postgresql://ids_admin:devpassword123@postgres:5432/ids_platform"
    redis_url: str = "redis://redis:6379/0"
    opensearch_url: str = "http://opensearch:9200"
    attack_log_index_pattern: str = "attack-logs-*"

    # 개별 이벤트 실시간 스트림 (app/event_stream.py) - events.normalized를 직접
    # tail해서 /ws/events로 릴레이한다. correlation-engine/normalizer와 값은 같지만
    # (kafka/docker-compose.yml 리스너 매핑 참고) platform-api는 이 토픽을 "쓰지"
    # 않고 별도 컨슈머 그룹으로 "읽기"만 하므로 그쪽 처리 경로와 완전히 독립적이다.
    kafka_brokers: str = "kafka:9092"
    kafka_normalized_topic: str = "events.normalized"
    kafka_event_stream_group: str = "platform-api-event-stream"

    # ClickHouse (P6-3) - servers/datastore/clickhouse/init/001-kafka-engine.sql의
    # Kafka 엔진 테이블이 events.normalized를 직접 구독해서 security_events_analytics
    # (컬럼형 MergeTree)에 실시간 적재해둔다. app/analytics_api.py가 이 테이블을 조회해서
    # 시계열/GeoIP/K8s타겟/Top IP 집계를 낸다 - OpenSearch(app/stats_api.py)는 검색/역인덱스
    # 용, ClickHouse는 대량 컬럼형 집계용으로 역할이 나뉜다(README 참고). 크리덴셜은
    # servers/datastore/clickhouse/docker-compose.yml의 dev 기본값 그대로.
    clickhouse_host: str = "clickhouse"
    clickhouse_port: int = 8123
    clickhouse_user: str = "admin"
    clickhouse_password: str = "mypassword"

    # 인증 (P5-2) - 스펙 미설계. Target에서 이관될 실제 역할 모델이 정해지기 전까지
    # 단일 관리자 계정 스텁으로만 동작.
    admin_username: str = "admin"
    admin_password: str = "changeme"

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
