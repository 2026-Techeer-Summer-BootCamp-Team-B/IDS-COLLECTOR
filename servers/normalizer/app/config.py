from typing import List

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Kafka - servers/docker-compose.yml로 다른 서비스들과 같은 siem-net 안에서 뜨는 게
    # 기본이라 내부 리스너(kafka:9092)를 기본값으로 둔다. 컨테이너 밖(로컬)에서 uvicorn으로
    # 직접 띄울 땐 .env에서 EXTERNAL 리스너(localhost:9094)로 바꿀 것 - kafka/docker-compose.yml
    # 리스너 매핑 주석 참고.
    kafka_brokers: str = "kafka:9092"

    # P2-1 토픽 분리 이후 소스별 원본 토픽을 전부 구독한다. 토픽 이름 자체가 소스를
    # 알려주므로 더 이상 log.source resource attribute에 의존하지 않는다.
    kafka_source_topics: str = "events.was,events.waf,events.falco,events.audit"
    kafka_consumer_group: str = "normalizer-workers"

    # 정규화 결과 재적재 토픽 (Data Prepper가 구독해서 OpenSearch에 색인 - P6-4).
    kafka_normalized_topic: str = "events.normalized"
    # parse 실패 시 보내는 DLQ 토픽 (P3-7).
    kafka_dlq_topic: str = "events.dlq"

    # dedupe (P3-2). audit=auditID, was/waf/falco=원본 해시. TTL 지나면 같은 이벤트가
    # 다시 들어와도 중복으로 안 걸러지는데, 리플레이 윈도우로는 1시간이면 충분하다고 판단.
    # 비밀번호는 servers/datastore/redis/.env의 REDIS_PASSWORD와 일치해야 함(servers/
    # docker-compose.yml 상단 주석 참고).
    redis_url: str = "redis://:CHANGE_ME_dev@redis:6379/0"
    dedupe_ttl_seconds: int = 3600

    # severity.yaml 경로 - app 패키지 기준 상대경로 (app/severity.py에서 resolve).
    severity_config_path: str = "severity.yaml"

    # exclusion_rules 캐시 갱신용 (app/exclusion.py, app/db.py) - platform-api/
    # correlation-engine과 동일한 DSN. 정규화 hot path에서 매 이벤트마다 DB를 치지
    # 않고 주기 폴링+캐시로 읽는다(poll_intervals의 exclusion_rules_refresh_seconds).
    # 이 기본값은 dev 전용 placeholder다 - 실값은 servers/docker-compose.yml의
    # POSTGRES_DSN(env var, ${POSTGRES_PASSWORD} 참조)이 컨테이너 기동 시 덮어쓴다.
    postgres_dsn: str = "postgresql://ids_admin:CHANGE_ME_dev@postgres:5432/ids_platform"

    class Config:
        env_file = ".env"

    @property
    def kafka_source_topics_list(self) -> List[str]:
        return [t.strip() for t in self.kafka_source_topics.split(",") if t.strip()]


settings = Settings()
