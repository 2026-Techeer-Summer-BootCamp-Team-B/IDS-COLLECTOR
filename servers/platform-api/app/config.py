from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # 이 기본값은 dev 전용 placeholder다 - 실값은 servers/docker-compose.yml의
    # POSTGRES_DSN(env var, ${POSTGRES_PASSWORD} 참조)이 컨테이너 기동 시 덮어쓴다.
    postgres_dsn: str = "postgresql://ids_admin:CHANGE_ME_dev@postgres:5432/ids_platform"
    # 세션(app/auth.py) + 시나리오 enabled 플래그(app/scenarios_api.py) 저장소. 비밀번호는
    # servers/datastore/redis/.env의 REDIS_PASSWORD와 일치해야 함(servers/docker-compose.yml
    # 상단 주석 참고).
    redis_url: str = "redis://:CHANGE_ME_dev@redis:6379/0"
    opensearch_url: str = "http://opensearch:9200"
    attack_log_index_pattern: str = "attack-logs-*"

    # app/pipeline_health_api.py의 컨슈머 lag/DLQ 깊이 조회(AIOKafkaConsumer/
    # AIOKafkaAdminClient)가 참조하는 브로커 주소 - platform-api는 이제 Kafka 토픽을
    # 직접 구독하지 않는다(2026-07-14, /ws/events + events.normalized 직접 tail
    # 컨슈머 제거 - 계약 v1.1 §7). 조회 전용 AdminClient 연결에만 쓰인다.
    kafka_brokers: str = "kafka:9092"

    # ClickHouse (P6-3) - servers/datastore/clickhouse/init/001-kafka-engine.sql의
    # Kafka 엔진 테이블이 events.normalized를 직접 구독해서 security_events_analytics
    # (컬럼형 MergeTree)에 실시간 적재해둔다. app/analytics_api.py가 이 테이블을 조회해서
    # 시계열/GeoIP/K8s타겟/Top IP 집계를 낸다 - OpenSearch(app/stats_api.py)는 검색/역인덱스
    # 용, ClickHouse는 대량 컬럼형 집계용으로 역할이 나뉜다(README 참고). 아래 password
    # 기본값은 dev 전용 placeholder다 - 실값은 servers/docker-compose.yml의
    # CLICKHOUSE_PASSWORD(env var, ${CLICKHOUSE_PASSWORD} 참조)가 덮어쓴다.
    clickhouse_host: str = "clickhouse"
    clickhouse_port: int = 8123
    clickhouse_user: str = "admin"
    clickhouse_password: str = "CHANGE_ME_dev"

    # AI 트렌드 리포트 (P5-4) - 비어있으면 "미설정" 응답만 반환. Gemini API 무료 티어 사용
    # (Google AI Studio에서 키 발급). 다른 모델로 바꾸고 싶으면 GEMINI_MODEL 환경변수만
    # 바꾸면 됨.
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.1-flash-lite"

    # 인증 세션 (P5-2) - app/auth.py가 Redis에 session:{token} 키로 저장, TTL 지나면
    # Redis가 알아서 지워줘서 별도 만료 처리 로직이 필요 없다.
    session_ttl_seconds: int = 86400

    # 리포트 알림 연동(Slack/Discord OAuth, P8) - app/crypto_utils.py(Fernet 대칭키)가
    # report_notification_connections.access_token_encrypted를 이 키로 암복호화한다.
    # Fernet.generate_key()로 만든 32바이트 urlsafe-base64 문자열이어야 함 - 이 기본값은
    # dev 전용 placeholder다(운영에서는 반드시 별도로 생성해 REPORT_TOKEN_ENCRYPTION_KEY
    # env로 덮어쓸 것 - 이 값이 바뀌면 기존에 암호화해둔 토큰은 전부 복호화 불가).
    report_token_encryption_key: str = "8yWaRahCNcYY6l5EmPqJtXtbaIdbpTkOGAZOFWU55Cw="

    # 스케줄 리포트의 Slack Block Kit/Discord Embed에 넣는 "대시보드로 이동" 딥링크의
    # 기준 origin. 프론트가 별도 레포/배포(Vercel 등)라 platform-api가 알 방법이 없어
    # 값으로 받는다 - 로컬 기본값은 dashboard `npm run dev`의 Vite 기본 포트.
    dashboard_base_url: str = "http://localhost:5173"

    # 프론트엔드가 별도 레포/팀이라 다른 origin에서 REST를 호출한다 - CORS 허용
    # origin 목록(콤마 구분). "*"면 전체 허용(개발 기본값, 쿠키/인증정보 없는
    # 토큰 방식이라 "*"라도 안전).
    cors_allowed_origins: str = "*"

    # 게이트웨이 시크릿(감사 S13, 2026-07-16) - Traefik이 platform-api로 라우팅하는
    # 모든 요청에 이 값을 X-Internal-Gateway-Secret 헤더로 주입한다(servers/
    # docker-compose.yml의 platform-api-gateway-secret 미들웨어, headers.
    # customrequestheaders). siem-net 안에서 Traefik을 거치지 않고 platform-api:8400에
    # 직접 붙는 요청은 이 헤더가 없으므로 app/main.py의 미들웨어(app/auth.py의
    # verify_gateway_secret())가 403으로 거부한다 - X-Auth-*(세션 신원, forwardAuth가
    # 실어줌)를 신뢰하기 전에 "이 요청이 정말 Traefik을 거쳐왔는가"부터 확인하는 게
    # 목적. 이 기본값은 dev 전용 placeholder다 - 실값은 servers/docker-compose.yml의
    # INTERNAL_GATEWAY_SECRET(env var, ${INTERNAL_GATEWAY_SECRET} 참조)이 컨테이너
    # 기동 시 덮어쓴다.
    internal_gateway_secret: str = "CHANGE_ME_dev"

    class Config:
        env_file = ".env"

    @property
    def cors_allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_allowed_origins.split(",") if o.strip()]


settings = Settings()
