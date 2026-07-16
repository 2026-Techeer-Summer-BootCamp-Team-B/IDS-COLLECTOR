"""
정규화 워커 서비스 (P3).

역할: Kafka 소스별 원본 토픽(events.was/waf/falco/audit)을 하나의 consumer group으로
      같이 구독해서 계속 꺼내와서
      1) dedupe (Redis SETNX, TTL 1h) - 중복이면 스킵
      2) parse (소스별 파서 4종 - 토픽 이름 자체가 소스를 알려준다)
      3) normalize (NormalizedEvent, ECS 서브셋)
      4) enrich (GeoIP + was/waf 정적 orchestrator 매핑)
      5) emit (events.normalized 재적재)

  (구 5단계 "exclude"(exclusion_rules 기반 저가치 노이즈 드롭)는 2026-07-15 제거됨 -
  EX-01/EX-02가 룰 이름/신원 패턴만으로 너무 거칠게 매칭해서, correlation-engine의
  S1/S5(컨테이너 침투 확인, severity 4)·S10(서비스어카운트 탈취 후 정찰, T1613)이
  실제로 봐야 할 이벤트까지 같이 드롭하는 게 실측 검토로 확인됐다 - IDS에서 로그
  volume 절감보다 탐지 누락 쪽이 훨씬 위험하다고 판단해 기능 자체를 뺐다. 노이즈가
  실제로 스토리지/조회 성능 문제가 될 정도로 쌓이면, 이번처럼 시나리오 매치 조건과
  겹치는지부터 검토한 뒤 훨씬 좁은 조건으로 다시 설계할 것.)

실패 처리 (P3-7):
  - parse 실패 -> events.dlq로 보내고 offset 커밋 (그 메시지는 버림, 재시도 안 함).
    dedupe 클레임은 유지 - 재시도할 게 아니라서 그대로 둬도 안전하다.
  - enrich/emit 실패 -> 같은 메시지를 최대 _MAX_PROCESS_ATTEMPTS번 그 자리에서
    즉시 재시도한다(correlation-engine/app/main.py의 재시도 패턴과 동일, 2026-07-15
    수정). 예전엔 "offset을 커밋하지 않고 다음 poll에서 같은 메시지를 재처리한다"고
    문서화돼 있었지만 사실이 아니었다 - aiokafka는 `async for msg in _consumer`가
    메시지를 yield하는 시점에 내부 fetch position을 이미 전진시키므로(commit()과
    무관), 실패한 메시지를 커밋 없이 건너뛰고 다음 메시지로 넘어가면(continue) 그
    다음 메시지가 성공해서 commit()이 호출되는 순간 실패한 메시지의 offset까지
    통째로 확정돼버려 재시도 기회 자체가 없었다(실측 확인 - 프로세스가 커밋 전에
    죽지 않는 한 영구 유실). 지금은 같은 메시지 안의 로그 레코드들을 처음부터 다시
    순회하는 방식으로 재시도한다 - 이미 emit에 성공한 레코드는 dedupe 클레임이
    풀리지 않은 상태라 재시도 중 is_duplicate()가 막아줘서 중복 emit 걱정 없이
    안전하게 재시도할 수 있다. 재시도를 모두 소진하면(일시적 장애가 아니라 결정적
    실패라는 뜻) 조용히 버리지 않고 parse 실패와 동일하게 DLQ로 보낸다 - 포이즌
    필이 파티션 전체를 영원히 막는 것도 막고, 유실 없이 항상 흔적을 남긴다.
    dedupe 클레임(is_duplicate())은 emit보다 먼저 선점되므로 실패 시 함께
    release()로 풀어준다 - 안 풀면 재시도 시도 자체가 "이미 처리됨"으로 오판돼
    스킵되고, 실제로는 emit된 적 없는 이벤트가 TTL(1h) 동안 영구 유실된다.

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
_MAX_PROCESS_ATTEMPTS = 3  # enrich/emit 실패 시 같은 메시지 재시도 상한 (아래 _consume_loop 참고)
_PROCESS_RETRY_BACKOFF_SECONDS = 1.0


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

    # dedupe 클레임(is_duplicate())은 이미 선점된 상태 - 아래에서 하나라도 실패하면
    # 그 클레임을 풀어야 한다. 안 풀면 예외가 위(_consume_loop)로 전파돼 offset
    # 커밋 없이 재시도하더라도, 재시도 시점의 is_duplicate()가 "이미 처리됨"으로
    # 오판해서 실제로는 emit된 적 없는 이벤트가 TTL(1h) 동안 영구 유실된다(dedupe.py
    # 의 release() 참고, 실측 확인 2026-07-15).
    try:
        enrich(source, payload, event)

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

            last_error: Optional[Exception] = None
            for attempt in range(1, _MAX_PROCESS_ATTEMPTS + 1):
                try:
                    for observed_time_unix_nano, body in _iter_log_records(message):
                        await _process_body(source, observed_time_unix_nano, body)
                    last_error = None
                    break
                except Exception as e:
                    last_error = e
                    if attempt < _MAX_PROCESS_ATTEMPTS:
                        print(
                            f"[normalizer] 이벤트 처리 실패 ({attempt}/{_MAX_PROCESS_ATTEMPTS}회), "
                            f"{_PROCESS_RETRY_BACKOFF_SECONDS}초 후 재시도: {e}"
                        )
                        await asyncio.sleep(_PROCESS_RETRY_BACKOFF_SECONDS)

            if last_error is not None:
                # 일시적 장애가 아니라 결정적 실패라는 뜻 - 조용히 버리면 이벤트가
                # 흔적도 없이 영구 유실되므로 parse 실패와 동일하게 DLQ로 보낸다.
                print(
                    f"[normalizer] 이벤트 처리 실패, {_MAX_PROCESS_ATTEMPTS}회 재시도 소진 - "
                    f"DLQ로 전송: {last_error}"
                )
                await producer.send_dlq(source, msg.value, f"process_error: {last_error}")

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
