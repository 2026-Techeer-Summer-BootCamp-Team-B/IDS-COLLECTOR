"""
Backend 워커 서비스.

역할: Redis Stream(stream:raw_events)에서 이벤트를 계속 꺼내와서
      1) 공통 스키마(AttackLog)로 정규화
      2) GeoIP enrichment (지금은 더미)
      3) OpenSearch에 저장
      4) Redis pub/sub으로 "저장 완료"를 실시간 알림 (나중에 WebSocket 서버가 구독)

FastAPI는 /health 체크 용도로만 쓰고, 진짜 작업은 백그라운드 asyncio 태스크가 함
(Ingest가 "빨리 받고 응답"이 목적이라면, Backend는 "느긋하게 계속 처리"가 목적).

실행 방법:
    uvicorn app.main:app --host 0.0.0.0 --port 8200
"""
import asyncio
import contextlib
import json

import redis.asyncio as aioredis
from fastapi import FastAPI

from app.config import settings
from app.es_client import client as es_client, ensure_index_exists
from app.geoip import lookup as geoip_lookup
from app.normalizer import normalize

app = FastAPI(title="IDS Backend Worker")

_redis: aioredis.Redis | None = None
_consumer_task: asyncio.Task | None = None


async def _ensure_consumer_group():
    """Redis Stream용 컨슈머 그룹을 최초 1회 생성 (이미 있으면 무시)."""
    try:
        await _redis.xgroup_create(
            settings.stream_key, settings.consumer_group, id="0", mkstream=True
        )
    except Exception as e:
        if "BUSYGROUP" not in str(e):
            raise


async def _process_one(entry_id: str, fields: dict) -> None:
    source = fields.get("source")
    raw_payload = json.loads(fields.get("payload", "{}"))

    attack_log = normalize(source, raw_payload)
    if attack_log is None:
        print(f"[worker] 아직 정규화 로직이 없는 소스: {source} (건너뜀)")
        return

    # GeoIP enrichment
    if attack_log.source_ip:
        geo = geoip_lookup(attack_log.source_ip)
        attack_log.geo_country_iso_code = geo["country_iso_code"]
        attack_log.geo_city_name = geo["city_name"]

    doc = attack_log.model_dump(by_alias=True, mode="json")
    es_client.index(index=settings.attack_log_index, id=attack_log.event_id, body=doc)

    # 실시간 알림 - 저장 완료된 이벤트를 pub/sub으로 브로드캐스트
    await _redis.publish(settings.events_channel, json.dumps(doc, ensure_ascii=False))

    print(f"[worker] 저장 완료 - {attack_log.event_module} {attack_log.event_action} "
          f"(severity={attack_log.event_severity})")


async def _consume_loop():
    await _ensure_consumer_group()
    print("[worker] Redis Stream 소비 시작...")

    while True:
        try:
            response = await _redis.xreadgroup(
                groupname=settings.consumer_group,
                consumername=settings.consumer_name,
                streams={settings.stream_key: ">"},
                count=10,
                block=5000,  # 5초 동안 새 이벤트 없으면 그냥 다시 대기
            )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[worker] Redis 읽기 오류: {e}")
            await asyncio.sleep(2)
            continue

        if not response:
            continue

        for _stream_key, entries in response:
            for entry_id, fields in entries:
                try:
                    await _process_one(entry_id, fields)
                except Exception as e:
                    print(f"[worker] 이벤트 처리 실패 ({entry_id}): {e}")
                finally:
                    # 처리 성공/실패 여부와 무관하게 일단 ACK
                    # (재처리 정책은 추후 개선 - 지금은 실패해도 큐가 안 막히게 하는 게 우선)
                    await _redis.xack(settings.stream_key, settings.consumer_group, entry_id)


@app.on_event("startup")
async def on_startup():
    global _redis, _consumer_task
    ensure_index_exists()
    _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    _consumer_task = asyncio.create_task(_consume_loop())


@app.on_event("shutdown")
async def on_shutdown():
    if _consumer_task:
        _consumer_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _consumer_task
    if _redis:
        await _redis.close()


@app.get("/health")
def health_check():
    return {"status": "ok"}