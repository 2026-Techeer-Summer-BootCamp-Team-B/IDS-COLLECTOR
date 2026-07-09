from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Redis 접속 정보 (지금은 큐 역할, 나중에 Kafka로 교체 예정)
    redis_url: str = "redis://localhost:6379/0"

    # 이벤트를 쌓을 Redis Stream 키 이름
    stream_key: str = "stream:raw_events"

    class Config:
        env_file = ".env"


settings = Settings()