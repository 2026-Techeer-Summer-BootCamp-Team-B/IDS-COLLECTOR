from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    kafka_brokers: str = "kafka:9092"
    kafka_normalized_topic: str = "events.normalized"
    kafka_consumer_group: str = "correlation-engine"

    # normalizer의 dedupe와 같은 Redis 인스턴스를 다른 키 네임스페이스(corr:*)로 공유한다.
    # 비밀번호는 servers/datastore/redis/.env의 REDIS_PASSWORD와 일치해야 함(servers/
    # docker-compose.yml 상단 주석 참고).
    redis_url: str = "redis://:CHANGE_ME_dev@redis:6379/0"

    postgres_dsn: str = "postgresql://ids_admin:devpassword123@postgres:5432/ids_platform"

    # 시나리오 정의 디렉터리 - app 패키지 기준 상대경로 (app/main.py에서 resolve).
    # 이 안의 *.yaml 파일을 전부 읽어서 합친다 (app/scenarios/README.md 참고).
    scenarios_config_path: str = "scenarios"

    class Config:
        env_file = ".env"


settings = Settings()
