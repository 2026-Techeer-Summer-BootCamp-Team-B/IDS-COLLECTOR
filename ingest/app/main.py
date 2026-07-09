"""
Ingest 서비스 - 감시 시스템의 첫 관문.

역할은 딱 하나: 외부(OTel Collector, 또는 지금은 테스트용 스크립트)에서
로그를 받아서, 최대한 빨리 큐(Redis Stream)에 넣고 응답하는 것.
GeoIP 조회, 정규화, 상관분석 같은 무거운 처리는 절대 여기서 하지 않는다
(그건 Backend 서비스가 큐에서 꺼내서 처리함).

실행 방법:
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8100
"""
import asyncio
import json
from datetime import datetime, timezone
from concurrent import futures

import grpc
from fastapi import FastAPI, HTTPException
from opentelemetry.proto.collector.logs.v1 import logs_service_pb2_grpc, logs_service_pb2

from app.redis_client import redis_client
from app.schemas import RawIngestEvent
from app.config import settings
from app.producer import LogProducer  # 카프카 프로듀서

# 1. 인프라 객체 초기화
app = FastAPI(
    title="IDS Ingest Service",
    description="WAS/Falco/K8s Audit 로그를 받아서 큐에 적재하는 전용 수집 서비스",
    version="0.1.0",
)
kafka_producer = LogProducer()


# ==========================================
# [HTTP 영역] 기존 팀원들의 테스트용 엔드포인트
# ==========================================

@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.post("/ingest/raw", status_code=202)
def ingest_raw(event: RawIngestEvent):
    """지금 단계(OTel 준비 전)에서 쓰는 테스트용 수신 엔드포인트."""
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
    """HTTP 방식의 OTel 수신 엔드포인트 (기존 미구현 규격 유지)"""
    raise HTTPException(status_code=501, detail="HTTP OTel 수신 로직은 제공하지 않습니다. 4317 gRPC 포트를 이용하세요.")


# ==========================================
# [gRPC 영역] OTel Collector -> Kafka 적재 관문
# ==========================================

class OTelLogService(logs_service_pb2_grpc.LogsServiceServicer):
    async def Export(self, request: logs_service_pb2.ExportLogsServiceRequest, context) -> logs_service_pb2.ExportLogsServiceResponse:
        try:
            for resource_logs in request.resource_logs:
                for scope_logs in resource_logs.scope_logs:
                    for log_record in scope_logs.log_records:
                        log_body = log_record.body.string_value
                        
                        # 아키텍처 다이어그램 기반 토픽 분류
                        if "falco" in log_body.lower():
                            topic = "falco-alerts"
                        elif "audit.k8s.io" in log_body:
                            topic = "k8s-audit"
                        else:
                            topic = "app-logs"
                        
                        # 카프카로 즉시 던지기
                        await kafka_producer.send_log(topic, {"raw_log": log_body})
                        
            return logs_service_pb2.ExportLogsServiceResponse()
        except Exception as e:
            context.set_details(str(e))
            context.set_code(grpc.StatusCode.INTERNAL)
            return logs_service_pb2.ExportLogsServiceResponse()


# ==========================================
# [실행 제어] 로컬 테스트 구동부
# ==========================================

# ingest/app/main.py 파일 수정

async def run_grpc_server():
    # 서버 켜지면 카프카 연결 시작
    await kafka_producer.start()
    
    server = grpc.aio.server(futures.ThreadPoolExecutor(max_workers=10))
    
    # ❌ 기존 코드:
    # logs_service_pb2_grpc.add_logs_service_servicer_to_server(OTelLogService(), server)
    
    # ✅ 변경된 코드:
    logs_service_pb2_grpc.add_LogsServiceServicer_to_server(OTelLogService(), server)
    
    # 로컬 테스트용 4317 gRPC 포트 개방
    server.add_insecure_port('[::]:4317')
    print("🚀 [Local Ingest] OTel gRPC 관문이 4317 포트에서 정상 대기 중입니다...")
    
    await server.start()
    try:
        await server.wait_for_termination()
    finally:
        await kafka_producer.stop()

print(f"현재 이 파일의 실행 이름(__name__)은 [{__name__}] 입니다!")#오류 테스트용

if __name__ == "__main__":
    # 터미널에서 python -m app.main 실행 시 gRPC 독점 서버로 구동
    asyncio.run(run_grpc_server())