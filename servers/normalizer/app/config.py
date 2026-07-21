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

    # dedupe.py/geoip.py의 redis.asyncio 클라이언트 소켓 타임아웃(2026-07-21) - 원래
    # 타임아웃 없이 연결해서, 네트워크 파티션(예: siem-net 스플릿)처럼 연결이 끊기지
    # 않고 그냥 응답이 안 오는 상황에서 await _redis.get/set(...)이 예외 없이 무한
    # 대기했다. dedupe.py/geoip.py의 fail-open 처리는 전부 `except Exception`으로
    # 예외가 나야만 발동하는 구조라, 이 무한 대기 동안 fail-open이 아예 발동을 못
    # 하고 - 컨슈머가 단일 태스크로 4개 토픽을 순차 처리하는 구조라 - 파이프라인
    # 전체가 멈췄다. 타임아웃을 넘기면 redis 라이브러리가 TimeoutError(Exception의
    # 하위 클래스)를 던지므로 기존 except 블록이 그대로 잡아 의도한 fail-open으로
    # 이어진다.
    redis_socket_connect_timeout_seconds: float = 3.0
    redis_socket_timeout_seconds: float = 3.0

    # severity.yaml 경로 - app 패키지 기준 상대경로 (app/severity.py에서 resolve).
    severity_config_path: str = "severity.yaml"

    # GeoLite2-City .mmdb 경로. 53MB 바이너리라 이미지에 굽지 않고(severity.yaml과 달리)
    # servers/docker-compose.yml이 read-only 볼륨으로 ./normalizer/data/GeoLite2-City.mmdb를
    # 이 경로(WORKDIR /app 기준)에 마운트한다 - 리포에도 커밋 안 함(.gitignore 참고).
    geoip_db_path: str = "data/GeoLite2-City.mmdb"

    class Config:
        env_file = ".env"

    @property
    def kafka_source_topics_list(self) -> List[str]:
        return [t.strip() for t in self.kafka_source_topics.split(",") if t.strip()]


settings = Settings()
