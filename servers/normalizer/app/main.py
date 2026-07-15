"""
정규화 워커 서비스 (P3).

역할: Kafka 소스별 원본 토픽(events.was/waf/falco/audit)을 하나의 consumer group으로
      같이 구독해서 계속 꺼내와서
      1) dedupe (Redis SETNX, TTL 1h) - 중복이면 스킵
      2) parse (소스별 파서 4종 - 토픽 이름 자체가 소스를 알려준다)
      3) normalize (NormalizedEvent, ECS 서브셋)
      4) enrich (GeoIP + was/waf 정적 orchestrator 매핑)
      5) exclude (app/exclusion.py - admin이 큐레이션한 exclusion_rules에 매칭되면
         저가치 노이즈로 보고 드롭, emit 안 함)
      6) emit (events.normalized 재적재)

실패 처리 (P3-7):
  - parse 실패 -> events.dlq로 보내고 offset 커밋 (그 메시지는 버림, 재시도 안 함).
    dedupe 클레임은 유지 - 재시도할 게 아니라서 그대로 둬도 안전하다.
  - enrich/exclusion/emit 실패 -> offset을 커밋하지 않고 그대로 두어 다음 poll에서
    같은 원본 메시지를 재처리한다. dedupe 클레임(is_duplicate())은 emit보다 먼저
    선점되므로 실패 시 함께 release()로 풀어준다 - 안 풀면 재처리 시도 자체가
    "이미 처리됨"으로 오판돼 스킵되고, 실제로는 emit된 적 없는 이벤트가 TTL(1h)
    동안 영구 유실된다(2026-07-15 실측 확인 후 수정 - 예전엔 이 release가 없어서
    "재처리 시 dedupe가 중복 emit을 막아준다"는 이 문단 자체가 틀린 가정이었다:
    dedupe가 막은 게 아니라 애초에 재처리 자체가 안 됐던 것).

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

from app import db, exclusion, producer
from app.config import settings
from app.dedupe import compute_dedupe_key, is_duplicate, release as release_dedupe
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
_exclusion_refresh_task: Optional[asyncio.Task] = None
_EXCLUSION_REFRESH_SECONDS = 30  # poll_intervals 테이블에 행이 없을 때의 fail-open 기본값


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


async def _exclusion_refresh_loop():
    """exclusion_rules(admin이 큐레이션한 노이즈 패턴)을 주기적으로 Postgres에서
    다시 읽어 app/exclusion.py의 인메모리 캐시에 반영한다 - 매 이벤트마다 DB를
    치면 정규화 hot path에 지연이 그대로 더해지니 correlation-engine의 allow_list
    캐시(app/main.py _allow_list_refresh_loop)와 동일하게 폴링+캐시로 뺐다.
    admin이 exclusion_rules를 켜고 꺼도 최대 이 주기만큼만 지나면 반영된다.

    interval 조회도 같은 try/except 안에서 한다 - platform-api의
    incident_alerts.py에서 실제로 겪은 사고(interval 조회 실패가 안 잡히고
    poll_loop 태스크 자체가 조용히 죽음)를 여기서 반복하지 않기 위함."""
    while True:
        interval = _EXCLUSION_REFRESH_SECONDS
        try:
            await exclusion.refresh_from_db()
            interval = await exclusion.fetch_poll_interval_seconds(
                "exclusion_rules_refresh_seconds", _EXCLUSION_REFRESH_SECONDS
            )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[normalizer] exclusion_rules 갱신 실패, 다음 주기에 재시도: {e}")
        await asyncio.sleep(interval)


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

    # dedupe 클레임(is_duplicate())은 이미 선점된 상태 - 아래에서 하나라도 실패하면
    # 그 클레임을 풀어야 한다. 안 풀면 예외가 위(_consume_loop)로 전파돼 offset
    # 커밋 없이 재시도하더라도, 재시도 시점의 is_duplicate()가 "이미 처리됨"으로
    # 오판해서 실제로는 emit된 적 없는 이벤트가 TTL(1h) 동안 영구 유실된다(dedupe.py
    # 의 release() 참고, 실측 확인 2026-07-15).
    try:
        enrich(source, payload, event)

        matched_rule_id = exclusion.matched_rule_id(event)
        if matched_rule_id is not None:
            # exclusion_rules에 매칭 - 저가치 노이즈로 판단된 이벤트라 events.normalized로
            # 내보내지 않는다(색인/상관분석 둘 다 안 봄). otel-logs-raw-*(포렌식 원본
            # 사본)는 이 워커보다 앞단(Data Prepper가 Kafka에서 직접 읽음)이라 영향
            # 없음 - 원본은 항상 100% 남는다는 계약 유지. 클레임은 유지 - 이건
            # 실패가 아니라 의도적으로 완결된 처리라 재시도할 필요가 없다.
            print(
                f"[normalizer] exclusion_rules 매칭, 드롭 - source={source} "
                f"rule={matched_rule_id} module={event.event_module}"
            )
            return

        # exclude_none=True: 해당 없는 필드는 null로 채우지 않고 아예 생략한다.
        doc = event.model_dump_json(by_alias=True, exclude_none=True).encode("utf-8")
        await producer.send_normalized(event.event_id, doc)

        print(
            f"[normalizer] emit 완료 - {event.event_module} {event.event_action} "
            f"(severity={event.event_severity})"
        )
    except Exception:
        await release_dedupe(dedupe_key)
        raise


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
    global _consumer_task, _exclusion_refresh_task
    await db.start()
    _consumer_task = asyncio.create_task(_consume_loop())
    _exclusion_refresh_task = asyncio.create_task(_exclusion_refresh_loop())


@app.on_event("shutdown")
async def on_shutdown():
    for task in (_consumer_task, _exclusion_refresh_task):
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
    await db.stop()


def _dead_task_reason() -> Optional[str]:
    """백그라운드 태스크(컨슈머, exclusion_rules 캐시 갱신)가 살아있지 않은
    이유(있으면) - /health가 503을 반환할지 판단하는 근거. None이면 정상."""
    if _consumer_task is None:
        return "consumer task not started"
    if _consumer_task.done():
        return "consumer task exited"
    if _exclusion_refresh_task is None:
        return "exclusion refresh task not started"
    if _exclusion_refresh_task.done():
        return "exclusion refresh task exited"
    return None


@app.get("/health")
def health_check():
    reason = _dead_task_reason()
    if reason:
        return JSONResponse(status_code=503, content={"status": "unhealthy", "reason": reason})
    return {"status": "ok"}
