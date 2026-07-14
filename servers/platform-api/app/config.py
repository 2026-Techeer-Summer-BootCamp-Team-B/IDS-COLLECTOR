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

    # AI 트렌드 리포트 (P5-4) - 비어있으면 "미설정" 응답만 반환. Gemini API 무료 티어 사용
    # (Google AI Studio에서 키 발급). 다른 모델로 바꾸고 싶으면 GEMINI_MODEL 환경변수만
    # 바꾸면 됨.
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.1-flash-lite"

    # 인증 세션 (P5-2) - app/auth.py가 Redis에 session:{token} 키로 저장, TTL 지나면
    # Redis가 알아서 지워줘서 별도 만료 처리 로직이 필요 없다.
    session_ttl_seconds: int = 86400

    # 인시던트 알림(Slack/Discord, app/incident_alerts.py) 폴링 주기 - 예전엔 Redis
    # pub/sub(incidents:events)로 발화 즉시 push했는데, platform-api가 재시작/단절된
    # 사이에 발화된 인시던트는 pub/sub 특성상 영구 유실됐다(재생 불가). incidents.
    # notified_at 컬럼 기반 폴링으로 바꿔서 이 유실 문제를 없애는 대신 최대 이 주기만큼
    # 알림이 지연된다.
    alert_poll_interval_seconds: int = 5

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
