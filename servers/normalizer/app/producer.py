"""events.normalized / events.dlq로 내보내는 Kafka producer 래퍼 (P3-1, P3-7)."""
import json
from typing import Optional

from aiokafka import AIOKafkaProducer

from app.config import settings

_producer: Optional[AIOKafkaProducer] = None


async def start() -> None:
    global _producer
    _producer = AIOKafkaProducer(bootstrap_servers=settings.kafka_brokers)
    await _producer.start()


async def stop() -> None:
    if _producer:
        await _producer.stop()


async def send_normalized(event_id: str, payload: bytes) -> None:
    """실패하면 예외가 그대로 위로 전파된다 - main.py가 이걸 잡아서 offset을
    커밋하지 않고 다음 poll에서 같은 원본 메시지를 재처리하게 한다 (P3-7)."""
    assert _producer is not None, "producer.start()를 먼저 호출해야 함"
    await _producer.send_and_wait(
        settings.kafka_normalized_topic, value=payload, key=event_id.encode("utf-8")
    )


async def send_dlq(source: str, raw_value: bytes, error: str) -> None:
    assert _producer is not None, "producer.start()를 먼저 호출해야 함"
    envelope = json.dumps(
        {
            "source": source,
            "error": error,
            "raw": raw_value.decode("utf-8", errors="replace"),
        },
        ensure_ascii=False,
    ).encode("utf-8")
    await _producer.send_and_wait(settings.kafka_dlq_topic, value=envelope)
