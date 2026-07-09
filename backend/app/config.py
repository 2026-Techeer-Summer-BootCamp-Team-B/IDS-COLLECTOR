from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Kafka - otel-collector가 OTLP 로그를 otlp_json 인코딩으로 발행하는 토픽을 구독한다.
    # backend를 지금처럼 컨테이너 밖(로컬)에서 uvicorn으로 직접 띄우는 게 기본이라
    # EXTERNAL 리스너(localhost:9092)를 기본값으로 둔다. 나중에 backend를 docker-compose
    # 안으로 옮기게 되면 .env에서 내부 리스너(kafka:9094)로 바꿀 것
    # (README "kafka 트러블 슈팅" 항목 참고).
    kafka_brokers: str = "localhost:9092"
    kafka_topic: str = "app-logs"
    kafka_consumer_group: str = "backend-workers"

    opensearch_url: str = "http://localhost:9200"
    attack_log_index: str = "attack-logs"

    class Config:
        env_file = ".env"


settings = Settings()
