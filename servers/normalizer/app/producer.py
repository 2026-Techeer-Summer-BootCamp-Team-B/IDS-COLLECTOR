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
    """실패하면 예외가 그대로 위로 전파된다 - main.py의 _process_body가 이 예외를
    받아 dedupe 클레임을 풀고 다시 던지면, _consume_loop의 재시도 루프가 같은 poll
    안에서 즉시(offset 커밋 전) 최대 _MAX_PROCESS_ATTEMPTS번 재시도한다. 그래도
    안 되면(결정적 실패) events.dlq로 보내고 나서야 offset을 커밋한다(2026-07-21,
    docstring을 실제 동작에 맞게 정정).

    ⚠️ "offset을 커밋하지 않고 다음 poll에서 재처리한다"는 이전 문구는 틀렸다 -
    aiokafka의 `async for msg in _consumer`는 메시지를 yield하는 시점에 내부 fetch
    position을 이미 전진시켜서(commit()과 무관), 커밋 없이 다음 메시지로 넘어가면
    (continue) 그 다음 메시지가 성공해 commit()이 불릴 때 실패한 메시지의 offset도
    통째로 확정돼버려 "다음 poll 재시도" 자체가 실제로는 일어나지 않았다(main.py
    모듈 docstring의 실패 처리 섹션 참고, 2026-07-15 실측 확인 후 현재 방식으로
    수정됨) - 이 파일의 docstring만 그 수정을 반영 못 하고 예전 설명을 그대로 두고
    있었다. 잘못된 설명을 보고 미래에 다시 "커밋 지연 + 다음 poll 재시도"로
    되돌리면 같은 유실 버그가 재발한다."""
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
