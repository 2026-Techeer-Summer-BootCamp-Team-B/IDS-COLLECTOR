"""
Ingest service - OTel gRPC logs gateway.

Role:
    Receive OTLP/gRPC logs, convert protobuf log records into JSON-friendly
    dictionaries, and publish them to Kafka as quickly as possible.

Run:
    python -m app.main

Note:
    gRPC/protobuf decompression and decoding are handled by grpc.aio and the
    OpenTelemetry protobuf stubs. This service converts decoded OTLP objects
    into JSON-serializable payloads for downstream engines.
"""
import asyncio
import json
from concurrent import futures
from datetime import datetime, timezone
from typing import Any

import grpc
from fastapi import FastAPI, HTTPException
from opentelemetry.proto.collector.logs.v1 import logs_service_pb2, logs_service_pb2_grpc

from app.config import settings
from app.producer import LogProducer
from app.redis_client import redis_client
from app.schemas import RawIngestEvent


app = FastAPI(
    title="IDS Ingest Service",
    description="WAS/Falco/K8s Audit 로그를 받아서 Kafka/Redis 큐에 적재하는 수집 서비스",
    version="0.1.0",
)
kafka_producer = LogProducer()


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.post("/ingest/raw", status_code=202)
def ingest_raw(event: RawIngestEvent):
    """OTel 준비 전 테스트용 HTTP 수신 엔드포인트."""
    try:
        redis_client.xadd(
            settings.stream_key,
            {
                "source": event.source,
                "received_at": datetime.now(timezone.utc).isoformat(),
                "payload": json.dumps(event.payload, ensure_ascii=False),
            },
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"큐 적재 실패: {e}")
    return {"queued": True}


@app.post("/ingest/otel", status_code=202)
def ingest_otel():
    raise HTTPException(
        status_code=501,
        detail="HTTP OTel 수신 로직은 제공하지 않습니다. 4317 gRPC 포트를 이용하세요.",
    )


def unix_nano_to_iso(value: int) -> str | None:
    if not value:
        return None
    return datetime.fromtimestamp(value / 1_000_000_000, tz=timezone.utc).isoformat()


def any_value_to_python(value) -> Any:
    """Convert OTLP AnyValue into a JSON-serializable Python value."""
    kind = value.WhichOneof("value")
    if kind is None:
        return None
    if kind == "string_value":
        return value.string_value
    if kind == "bool_value":
        return value.bool_value
    if kind == "int_value":
        return value.int_value
    if kind == "double_value":
        return value.double_value
    if kind == "bytes_value":
        return value.bytes_value.hex()
    if kind == "array_value":
        return [any_value_to_python(item) for item in value.array_value.values]
    if kind == "kvlist_value":
        return kvlist_to_dict(value.kvlist_value.values)
    return None


def kvlist_to_dict(items) -> dict[str, Any]:
    return {item.key: any_value_to_python(item.value) for item in items}


def parse_body_as_json_if_possible(body: Any) -> Any:
    if not isinstance(body, str):
        return body
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return body


def build_kafka_event(resource, scope, log_record) -> dict[str, Any]:
    body = any_value_to_python(log_record.body)
    attributes = kvlist_to_dict(log_record.attributes)
    resource_attributes = kvlist_to_dict(resource.attributes)

    return {
        "ingested_at": datetime.now(timezone.utc).isoformat(),
        "otel": {
            "timestamp_unix_nano": log_record.time_unix_nano,
            "timestamp": unix_nano_to_iso(log_record.time_unix_nano),
            "observed_time_unix_nano": log_record.observed_time_unix_nano,
            "observed_time": unix_nano_to_iso(log_record.observed_time_unix_nano),
            "severity_text": log_record.severity_text,
            "severity_number": int(log_record.severity_number),
            "trace_id": log_record.trace_id.hex(),
            "span_id": log_record.span_id.hex(),
            "flags": log_record.flags,
        },
        "resource": resource_attributes,
        "scope": {
            "name": scope.name,
            "version": scope.version,
            "attributes": kvlist_to_dict(scope.attributes),
        },
        "attributes": attributes,
        "body": parse_body_as_json_if_possible(body),
        "raw_log": body if isinstance(body, str) else json.dumps(body, ensure_ascii=False),
    }


def select_topic(event: dict[str, Any]) -> str:
    text = json.dumps(
        {
            "body": event.get("body"),
            "raw_log": event.get("raw_log"),
            "attributes": event.get("attributes"),
            "resource": event.get("resource"),
        },
        ensure_ascii=False,
    ).lower()

    if "falco" in text:
        return "falco-alerts"
    if "audit.k8s.io" in text or "k8s-audit" in text:
        return "k8s-audit"
    return "app-logs"


class OTelLogService(logs_service_pb2_grpc.LogsServiceServicer):
    async def Export(
        self,
        request: logs_service_pb2.ExportLogsServiceRequest,
        context,
    ) -> logs_service_pb2.ExportLogsServiceResponse:
        try:
            send_tasks = []
            for resource_logs in request.resource_logs:
                resource = resource_logs.resource
                for scope_logs in resource_logs.scope_logs:
                    scope = scope_logs.scope
                    for log_record in scope_logs.log_records:
                        event = build_kafka_event(resource, scope, log_record)
                        topic = select_topic(event)
                        send_tasks.append(kafka_producer.send_log(topic, event))

            if send_tasks:
                await asyncio.gather(*send_tasks)

            return logs_service_pb2.ExportLogsServiceResponse()
        except Exception as e:
            context.set_details(str(e))
            context.set_code(grpc.StatusCode.INTERNAL)
            return logs_service_pb2.ExportLogsServiceResponse()


async def run_grpc_server():
    await kafka_producer.start()

    server = grpc.aio.server(futures.ThreadPoolExecutor(max_workers=10))
    logs_service_pb2_grpc.add_LogsServiceServicer_to_server(OTelLogService(), server)

    server.add_insecure_port("[::]:4317")
    print("[Local Ingest] OTel gRPC gateway is listening on port 4317")

    await server.start()
    try:
        await server.wait_for_termination()
    finally:
        await kafka_producer.stop()


if __name__ == "__main__":
    asyncio.run(run_grpc_server())