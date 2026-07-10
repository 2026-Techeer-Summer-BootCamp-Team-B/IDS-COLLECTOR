"""
상관분석 엔진 서비스 (P4).

events.normalized를 실시간 소비 -> 시나리오 룰 평가(threshold/sequence, app/rules.py) ->
발화 시 인시던트 upsert(PG, app/incidents.py) + Redis pub/sub 발행(대시보드 WebSocket
푸시용 - 실제 WebSocket 서버는 platform-api/dashboard 쪽에서 이 채널을 구독한다).

시나리오 정의는 scenarios.yaml(YAML 선언 룰)에서 로드한다 - 지금 들어있는 stage1/stage2
매칭 조건은 엔진 동작 검증용 예시고, 실제 공격 체인 정의는 팀 설계 후 그 파일만
교체하면 된다.

실행 방법 (컨테이너):
    servers/docker-compose.yml에 포함되어 있음 - 저장소 루트에서 `make up`
    (또는 `docker compose -f servers/docker-compose.yml up -d --build`)으로 기동.
"""
import asyncio
import contextlib
import json
import uuid
from pathlib import Path
from typing import Optional

import redis.asyncio as redis
import yaml
from aiokafka import AIOKafkaConsumer
from fastapi import FastAPI

from app import incidents, mitre_mapping
from app.config import settings
from app.rules import ScenarioEngine
from app.schemas import NormalizedEvent

app = FastAPI(title="IDS Correlation Engine")

_consumer: Optional[AIOKafkaConsumer] = None
_consumer_task: Optional[asyncio.Task] = None
_engine: Optional[ScenarioEngine] = None
_redis: Optional["redis.Redis"] = None

INCIDENT_CHANNEL = "incidents:events"


def _load_scenarios() -> list:
    path = Path(settings.scenarios_config_path)
    if not path.is_absolute():
        path = Path(__file__).resolve().parent / path
    with open(path, "r", encoding="utf-8") as f:
        scenarios = yaml.safe_load(f)["scenarios"]

    # scenario_rules.id는 PostgreSQL UUID 컬럼이라, YAML의 사람이 읽는 코드(S1/S2/S4)를
    # 결정적으로 UUID로 변환해서 db_id에 얹는다 - 같은 코드는 재시작해도 항상 같은
    # UUID가 나오므로 sync_scenario_rules가 매번 같은 행을 덮어쓴다(중복 insert 없음).
    for scenario in scenarios:
        scenario["db_id"] = str(uuid.uuid5(uuid.NAMESPACE_OID, f"scenario:{scenario['id']}"))
    return scenarios


async def _consume_loop():
    global _consumer, _engine, _redis

    _redis = redis.from_url(settings.redis_url, decode_responses=True)
    scenarios = _load_scenarios()
    _engine = ScenarioEngine(scenarios, _redis)

    _consumer = AIOKafkaConsumer(
        settings.kafka_normalized_topic,
        bootstrap_servers=settings.kafka_brokers,
        group_id=settings.kafka_consumer_group,
        enable_auto_commit=False,
    )

    while True:
        try:
            await _consumer.start()
            break
        except Exception as e:
            print(f"[correlation] Kafka 연결 실패, 3초 후 재시도: {e}")
            await asyncio.sleep(3)

    await incidents.start()
    await incidents.sync_scenario_rules(scenarios)
    print(f"[correlation] 시작 - topic={settings.kafka_normalized_topic}")

    try:
        async for msg in _consumer:
            try:
                event = NormalizedEvent.model_validate_json(msg.value)
            except Exception as e:
                print(f"[correlation] 이벤트 파싱 실패, 스킵: {e}")
                await _consumer.commit()
                continue

            fired = await _engine.evaluate(event)
            for f in fired:
                incident = await incidents.upsert_incident(
                    f["scenario_db_id"],
                    f["scenario_name"],
                    f["correlation_key_type"],
                    f["join_key"],
                    f["severity"],
                    mitre_mapping.tactics_for_technique(f["mitre_technique_id"]),
                    f["events"],
                )
                await _redis.publish(INCIDENT_CHANNEL, json.dumps(incident, default=str))
                print(
                    f"[correlation] 인시던트 발화 - {f['scenario_name']} "
                    f"join_key={f['join_key']}"
                )

            await _consumer.commit()
    except asyncio.CancelledError:
        raise
    finally:
        await incidents.stop()
        await _consumer.stop()


def _log_task_exception(task: "asyncio.Task") -> None:
    if task.cancelled() or task.exception() is None:
        return
    exc = task.exception()
    import traceback

    traceback.print_exception(type(exc), exc, exc.__traceback__)


@app.on_event("startup")
async def on_startup():
    global _consumer_task
    _consumer_task = asyncio.create_task(_consume_loop())
    _consumer_task.add_done_callback(_log_task_exception)


@app.on_event("shutdown")
async def on_shutdown():
    if _consumer_task:
        _consumer_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _consumer_task


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/debug/missing-join-count")
def missing_join_count():
    """P7-3 파이프라인 헬스 뷰 참고용 join 결측 카운터.
    지금은 in-memory라 재시작하면 0으로 리셋된다 - 영속시키려면 Redis INCR로 바꿀 것."""
    return {"missing_join_count": _engine.missing_join_count if _engine else 0}
