"""
정규화 워커 서비스 (P3).

역할: Kafka 소스별 원본 토픽(events.was/waf/falco/audit)을 하나의 consumer group으로
      같이 구독해서 계속 꺼내와서
      1) dedupe (Redis SETNX, TTL 1h) - 중복이면 스킵
      2) parse (소스별 파서 4종 - 토픽 이름 자체가 소스를 알려준다)
      3) normalize (NormalizedEvent, ECS 서브셋)
      4) enrich (GeoIP + was/waf 정적 orchestrator 매핑)
      5) emit (events.normalized 재적재)

실패 처리 (P3-7):
  - parse 실패 -> events.dlq로 보내고 offset 커밋 (그 메시지는 버림, 재시도 안 함)
  - emit(정규화 재적재) 실패 -> offset을 커밋하지 않고 그대로 두어 다음 poll에서
    같은 원본 메시지를 재처리한다. 재처리 시 이미 처리된 레코드는 dedupe에서
    걸러지므로 중복 emit 걱정은 안 해도 된다.

이 워커는 더 이상 OpenSearch에 직접 쓰지 않는다 - 색인은 Data Prepper가
events.normalized를 구독해서 담당한다 (P6-4, 자체 색인 코드 대체).

FastAPI는 /health 체크 용도로만 쓰고, 진짜 작업은 백그라운드 asyncio 태스크가 함.
/health는 이 컨슈머 태스크가 죽었으면(started된 적 없거나 done()) 503을 반환한다 -
프로세스는 살아있는데 컨슈머만 죽어서 파이프라인이 조용히 멈추는 걸 감지하기 위함
(servers/docker-compose.yml의 healthcheck가 이 엔드포인트를 주기 폴링).

실행 방법 (컨테이너, 기본):
    servers/docker-compose.yml에 포함되어 있음 - 저장소 루트에서 `make up`
    (또는 `docker compose -f servers/docker-compose.yml up -d --build`)으로 기동.
    이 경우 siem-net 내부 리스너(kafka:9092)를 그대로 쓴다.

로컬에서 uvicorn 직접 실행 시:
    uvicorn app.main:app --host 0.0.0.0 --port 8200
    .env에서 kafka_brokers를 EXTERNAL 리스너(localhost:9094)로, redis_url을
    redis://:<servers/datastore/redis/.env의 REDIS_PASSWORD>@localhost:6379/0으로
    바꿀 것 (kafka/docker-compose.yml 리스너 매핑 주석 참고. Redis는 requirepass가
    걸려 있어 비밀번호 없이는 연결이 거부된다).
"""
import asyncio
import contextlib
import json
from typing import Any, Dict, Optional

from aiokafka import AIOKafkaConsumer
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from app import producer
from app.config import settings
from app.dedupe import compute_dedupe_key, is_duplicate
from app.enrichment import enrich
from app.normalizer import normalize

app = FastAPI(title="IDS Normalizer Worker")

# Kafka 토픽 이름 -> source. P2-1 토픽 분리 이후로는 이게 곧 소스 판별 기준이라
# log.source resource attribute는 더 이상 참조하지 않는다.
_TOPIC_TO_SOURCE = {
    "events.was": "was",
    "events.waf": "waf",
    "events.falco": "falco",
    "events.audit": "audit",
}

_consumer: Optional[AIOKafkaConsumer] = None
_consumer_task: Optional[asyncio.Task] = None


def _any_value_to_python(value: Optional[Dict[str, Any]]) -> Any:
    """OTLP JSON(otlp_json 인코딩)의 AnyValue를 파이썬 값으로 변환.

    protobuf JSON 매핑 규칙상 int64(intValue)는 문자열로 온다는 점만 주의.
    """
    if not value:
        return None
    if "stringValue" in value:
        return value["stringValue"]
    if "boolValue" in value:
        return value["boolValue"]
    if "intValue" in value:
        return int(value["intValue"])
    if "doubleValue" in value:
        return value["doubleValue"]
    if "bytesValue" in value:
        return value["bytesValue"]
    if "arrayValue" in value:
        return [_any_value_to_python(v) for v in value["arrayValue"].get("values", [])]
    if "kvlistValue" in value:
        return _kvlist_to_dict(value["kvlistValue"].get("values", []))
    return None


def _kvlist_to_dict(items: list) -> Dict[str, Any]:
    return {item["key"]: _any_value_to_python(item.get("value")) for item in items}


def _iter_log_records(message: Dict[str, Any]):
    """otlp_json으로 인코딩된 Kafka 메시지 하나(ExportLogsServiceRequest 형태)에서
    (observedTimeUnixNano, body)를 로그 레코드 단위로 하나씩 뽑아준다.
    observedTimeUnixNano는 dedupe 해시 계산에 쓰인다 (app/dedupe.py 참고)."""
    for resource_logs in message.get("resourceLogs", []):
        for scope_logs in resource_logs.get("scopeLogs", []):
            for log_record in scope_logs.get("logRecords", []):
                observed = log_record.get("observedTimeUnixNano", "")
                yield observed, _any_value_to_python(log_record.get("body"))


def _body_to_payload(body: Any) -> tuple[Dict[str, Any], str]:
    """body를 (payload dict, 원본 JSON 문자열) 튜플로 변환.

    mysite otel-collector 설정 기준: WAS/K8s Audit/WAF는 filelog의 json_parser
    오퍼레이터를 거쳐 body가 이미 dict로 오고, Falco는 json_parser가 없어서
    body가 JSON 문자열 그대로 온다 - 두 경우 다 여기서 흡수한다. 원본 문자열은
    dedupe 해시(sha256)와 event_original 필드에 그대로 쓰인다.
    """
    if isinstance(body, dict):
        return body, json.dumps(body, ensure_ascii=False)
    if isinstance(body, str):
        try:
            parsed = json.loads(body)
            if isinstance(parsed, dict):
                return parsed, body
        except json.JSONDecodeError:
            pass
    return {"raw": body}, json.dumps({"raw": body}, ensure_ascii=False)


async def _process_body(source: str, observed_time_unix_nano: str, body: Any) -> None:
    payload, original = _body_to_payload(body)

    # k8s audit는 ResponseComplete 스테이지만 채택 - RequestReceived 등 중간
    # 스테이지는 같은 auditID로 여러 번 들어오므로 여기서 조용히 드롭한다
    # (dedupe/파싱 단계까지 가지 않음).
    if source == "audit" and payload.get("stage") != "ResponseComplete":
        return

    dedupe_key = compute_dedupe_key(source, payload, original, observed_time_unix_nano)
    if await is_duplicate(dedupe_key):
        print(f"[normalizer] 중복 스킵 - source={source} key={dedupe_key[:12]}...")
        return

    try:
        event = normalize(source, payload, dedupe_key, original)
    except Exception as e:
        print(f"[normalizer] parse 실패, DLQ로 전송 - source={source}: {e}")
        await producer.send_dlq(source, original.encode("utf-8"), str(e))
        return

    enrich(source, payload, event)

    # exclude_none=True: 해당 없는 필드는 null로 채우지 않고 아예 생략한다.
    doc = event.model_dump_json(by_alias=True, exclude_none=True).encode("utf-8")
    # 실패하면 예외가 위(_consume_loop)로 전파되어 offset을 커밋하지 않는다.
    await producer.send_normalized(event.event_id, doc)

    print(
        f"[normalizer] emit 완료 - {event.event_module} {event.event_action} "
        f"(severity={event.event_severity})"
    )


async def _consume_loop():
    global _consumer

    _consumer = AIOKafkaConsumer(
        *settings.kafka_source_topics_list,
        bootstrap_servers=settings.kafka_brokers,
        group_id=settings.kafka_consumer_group,
        enable_auto_commit=False,
    )

    while True:
        try:
            await _consumer.start()
            break
        except Exception as e:
            print(f"[normalizer] Kafka 연결 실패, 3초 후 재시도: {e}")
            await asyncio.sleep(3)

    await producer.start()

    print(
        f"[normalizer] Kafka Consumer 시작 - brokers={settings.kafka_brokers} "
        f"topics={settings.kafka_source_topics_list}"
    )

    try:
        async for msg in _consumer:
            source = _TOPIC_TO_SOURCE[msg.topic]
            try:
                message = json.loads(msg.value.decode("utf-8"))
            except json.JSONDecodeError as e:
                print(f"[normalizer] Kafka 메시지 JSON 파싱 실패, DLQ로 전송: {e}")
                await producer.send_dlq(source, msg.value, f"json_decode_error: {e}")
                await _consumer.commit()
                continue

            try:
                for observed_time_unix_nano, body in _iter_log_records(message):
                    await _process_body(source, observed_time_unix_nano, body)
            except Exception as e:
                # emit 실패 등 - offset 커밋 안 하고 다음 poll에서 같은 메시지 재처리.
                print(f"[normalizer] 이벤트 처리 실패, 커밋 보류: {e}")
                await asyncio.sleep(1)
                continue

            await _consumer.commit()
    except asyncio.CancelledError:
        raise
    finally:
        await producer.stop()
        await _consumer.stop()


@app.on_event("startup")
async def on_startup():
    global _consumer_task
    _consumer_task = asyncio.create_task(_consume_loop())


@app.on_event("shutdown")
async def on_shutdown():
    if _consumer_task:
        _consumer_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _consumer_task


def _dead_task_reason() -> Optional[str]:
    """백그라운드 컨슈머 태스크가 살아있지 않은 이유(있으면) - /health가 503을
    반환할지 판단하는 근거. None이면 정상."""
    if _consumer_task is None:
        return "consumer task not started"
    if _consumer_task.done():
        return "consumer task exited"
    return None


@app.get("/health")
def health_check():
    reason = _dead_task_reason()
    if reason:
        return JSONResponse(status_code=503, content={"status": "unhealthy", "reason": reason})
    return {"status": "ok"}
