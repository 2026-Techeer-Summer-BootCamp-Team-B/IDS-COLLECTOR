"""상관분석 엔진이 발화 시 발행하는 Redis pub/sub(`incidents:events`, P4-4)를 그대로
WebSocket으로 릴레이한다 - 대시보드 실시간 피드/CRITICAL 팝업(P7-1)이 이 엔드포인트를
구독한다. CRITICAL이면 알림 채널(P5-3)도 같이 트리거."""
import json
from typing import Set

import redis.asyncio as redis
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.config import settings
from app.notifications import notify_incident

router = APIRouter()

_clients: Set[WebSocket] = set()

INCIDENT_CHANNEL = "incidents:events"


@router.websocket("/ws/incidents")
async def incidents_ws(websocket: WebSocket):
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
    r = redis.from_url(settings.redis_url, decode_responses=True)
    pubsub = r.pubsub()
    await pubsub.subscribe(INCIDENT_CHANNEL)

    async for message in pubsub.listen():
        if message["type"] != "message":
            continue

        incident = json.loads(message["data"])
        await notify_incident(incident)

        dead = []
        for client in _clients:
            try:
                await client.send_text(message["data"])
            except Exception:
                dead.append(client)
        for client in dead:
            _clients.discard(client)
