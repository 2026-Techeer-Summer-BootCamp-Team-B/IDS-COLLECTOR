import asyncio
import grpc
from opentelemetry.proto.collector.logs.v1 import logs_service_pb2_grpc, logs_service_pb2
from opentelemetry.proto.logs.v1 import logs_pb2
from opentelemetry.proto.common.v1 import common_pb2  # 💡 AnyValue가 사는 곳

async def send_test_log(message: str):
    # main.py의 4317 gRPC 포트로 연결
    async with grpc.aio.insecure_channel('localhost:4317') as channel:
        stub = logs_service_pb2_grpc.LogsServiceStub(channel)
        
        # 💡 common_pb2.AnyValue로 규격 수정 (에러 해결 핵심)
        log_record = logs_pb2.LogRecord(
            body=common_pb2.AnyValue(string_value=message)
        )
        scope_log = logs_pb2.ScopeLogs(log_records=[log_record])
        resource_log = logs_pb2.ResourceLogs(scope_logs=[scope_log])
        request = logs_service_pb2.ExportLogsServiceRequest(resource_logs=[resource_log])
        
        # gRPC 발송
        await stub.Export(request)
        print(f"✅ [Client] 테스트 로그 발송 완료: -> {message[:30]}...")

if __name__ == "__main__":
    # 1. Falco 위협 로그 시뮬레이션
    asyncio.run(send_test_log("Warning: Falco detected terminal shell spawned in container"))
    # 2. 일반 애플리케이션 로그 시뮬레이션
    asyncio.run(send_test_log("Info: User hajh1 logged in successfully from product page"))