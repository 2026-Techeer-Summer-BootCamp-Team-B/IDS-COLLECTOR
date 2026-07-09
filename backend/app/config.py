from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    redis_url: str = "redis://localhost:6379/0"
    stream_key: str = "stream:raw_events"
    consumer_group: str = "backend_workers"
    consumer_name: str = "worker-1"

    opensearch_url: str = "http://localhost:9200"
    attack_log_index: str = "attack-logs"

    # 정규화된 이벤트를 실시간으로 대시보드에 알리기 위한 pub/sub 채널
    events_channel: str = "channel:events"

    class Config:
        env_file = ".env"


settings = Settings()