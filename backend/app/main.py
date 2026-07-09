"""
Backend 워커 서비스.

역할: Kafka 토픽(app-logs)에서 otel-collector가 otlp_json 인코딩으로 발행한
      로그를 계속 꺼내와서
      1) resource attribute `log.source`(was/falco/k8s-audit)로 로그 종류 판별
      2) 공통 스키마(AttackLog)로 정규화
      3) GeoIP enrichment (지금은 더미)
      4) OpenSearch에 저장

FastAPI는 /health 체크 용도로만 쓰고, 진짜 작업은 백그라운드 asyncio 태스크가 함
(Ingest가 "빨리 받고 응답"이 목적이라면, Backend는 "느긋하게 계속 처리"가 목적).

실행 방법:
    uvicorn app.main:app --host 0.0.0.0 --port 8200

Kafka 브로커 주소는 실행 환경에 따라 다름 (README "kafka 트러블 슈팅" 참고):
    - backend를 지금처럼 컨테이너 밖(로컬)에서 그대로 uvicorn으로 띄우면
      EXTERNAL 리스너(localhost:9092)
    - backend를 나중에 docker-compose 안으로 옮기면 내부 리스너(kafka:9094)

(예전엔 Redis Stream을 구독했지만, 그 스트림에 쓰던 ingest 서비스가 삭제되고
 otel-collector -> Kafka 파이프라인으로 완전히 대체되면서 Redis 자체를 걷어냈다.
 실시간 알림도 WebSocket을 안 쓰기로 해서 별도 재구현 없이 그대로 제외.)
"""
import asyncio
import contextlib
import json
from typing import Any, Dict, Optional

from aiokafka import AIOKafkaConsumer
from fastapi import FastAPI

from app.config import settings
from app.es_client import client as es_client, ensure_index_exists
from app.geoip import lookup as geoip_lookup
from app.normalizer import normalize

app = FastAPI(title="IDS Backend Worker")

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
    (resource_attributes, body) 튜플을 로그 레코드 단위로 하나씩 뽑아준다."""
    for resource_logs in message.get("resourceLogs", []):
        resource_attrs = _kvlist_to_dict(
            resource_logs.get("resource", {}).get("attributes", [])
        )
        for scope_logs in resource_logs.get("scopeLogs", []):
            for log_record in scope_logs.get("logRecords", []):
                body = _any_value_to_python(log_record.get("body"))
                yield resource_attrs, body


def _body_to_payload(body: Any) -> Dict[str, Any]:
    """body가 JSON 문자열이면 파싱해서 dict로, 이미 dict면 그대로 반환.

    mysite otel-collector 설정 기준: WAS/K8s Audit는 filelog의 json_parser
    오퍼레이터를 거쳐 body가 이미 dict로 오고, Falco는 json_parser가 없어서
    body가 JSON 문자열 그대로 온다 - 두 경우 다 여기서 흡수한다.
    """
    if isinstance(body, dict):
        return body
    if isinstance(body, str):
        try:
            parsed = json.loads(body)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass
    return {"raw": body}


async def _process_record(resource_attrs: Dict[str, Any], body: Any) -> None:
    source = resource_attrs.get("log.source")
    payload = _body_to_payload(body)

    attack_log = normalize(source, payload)
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

    print(f"[worker] 저장 완료 - {attack_log.event_module} {attack_log.event_action} "
          f"(severity={attack_log.event_severity})")


async def _consume_loop():
    global _consumer

    _consumer = AIOKafkaConsumer(
        settings.kafka_topic,
        bootstrap_servers=settings.kafka_brokers,
        group_id=settings.kafka_consumer_group,
    )

    while True:
        try:
            await _consumer.start()
            break
        except Exception as e:
            print(f"[worker] Kafka 연결 실패, 3초 후 재시도: {e}")
            await asyncio.sleep(3)

    print(f"[worker] Kafka Consumer 시작 - brokers={settings.kafka_brokers} "
          f"topic={settings.kafka_topic}")

    try:
        async for msg in _consumer:
            try:
                message = json.loads(msg.value.decode("utf-8"))
            except json.JSONDecodeError as e:
                print(f"[worker] Kafka 메시지 JSON 파싱 실패: {e}")
                continue

            for resource_attrs, body in _iter_log_records(message):
                try:
                    await _process_record(resource_attrs, body)
                except Exception as e:
                    print(f"[worker] 이벤트 처리 실패: {e}")
    except asyncio.CancelledError:
        raise
    finally:
        await _consumer.stop()


@app.on_event("startup")
async def on_startup():
    global _consumer_task
    ensure_index_exists()
    _consumer_task = asyncio.create_task(_consume_loop())


@app.on_event("shutdown")
async def on_shutdown():
    if _consumer_task:
        _consumer_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _consumer_task


@app.get("/health")
def health_check():
    return {"status": "ok"}
