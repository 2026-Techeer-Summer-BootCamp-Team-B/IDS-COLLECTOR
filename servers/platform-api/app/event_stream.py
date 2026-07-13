"""개별 정규화 이벤트 실시간 스트림 (/ws/events) - app/websocket.py(/ws/incidents)와
역할이 다르다: 그쪽은 상관분석 엔진이 Redis에 발행한 "발화된 인시던트"만 흘려보내고,
여긴 events.normalized 토픽을 직접 tail해서 was/waf/falco/k8s_audit 이벤트 하나하나를
그대로 내보낸다(대시보드 하단 티커/CRITICAL 팝업이 원하는 "개별 탐지" 단위 스트림).

correlation-engine의 처리 경로와는 완전히 독립된 컨슈머 그룹으로 같은 토픽을 병렬
구독한다 - ClickHouse의 Kafka 엔진 테이블(servers/datastore/clickhouse/init/
001-kafka-engine.sql)도 이미 같은 패턴으로 이 토픽을 따로 읽고 있다. UI 티커
용도라 exactly-once 보장이 필요 없어서 auto-commit + latest 오프셋으로 가볍게
구현한다(재시작 시 과거 이벤트를 다시 리플레이하지 않고 그 시점 이후 것만 받는다)."""
import asyncio
from typing import Optional, Set

from aiokafka import AIOKafkaConsumer
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

from app.auth import Session, get_ws_session
from app.config import settings

router = APIRouter()

_clients: Set[WebSocket] = set()
_consumer: Optional[AIOKafkaConsumer] = None


@router.websocket("/ws/events")
async def events_ws(websocket: WebSocket, session: Session = Depends(get_ws_session)):
    await websocket.accept()
    _clients.add(websocket)
    try:
        while True:
            # 클라이언트 -> 서버 메시지는 안 씀, 연결이 끊기는 걸 감지하려고 계속 받기만 한다.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _clients.discard(websocket)


async def relay_loop() -> None:
    global _consumer
    _consumer = AIOKafkaConsumer(
        settings.kafka_normalized_topic,
        bootstrap_servers=settings.kafka_brokers,
        group_id=settings.kafka_event_stream_group,
        enable_auto_commit=True,
        auto_offset_reset="latest",
    )

    while True:
        try:
            await _consumer.start()
            break
        except Exception as e:
            print(f"[platform-api] events.normalized Kafka 연결 실패, 3초 후 재시도: {e}")
            await asyncio.sleep(3)

    try:
        async for msg in _consumer:
            text = msg.value.decode("utf-8")
            dead = []
            for client in _clients:
                try:
                    await client.send_text(text)
                except Exception:
                    dead.append(client)
            for client in dead:
                _clients.discard(client)
    except asyncio.CancelledError:
        raise
    finally:
        await _consumer.stop()
