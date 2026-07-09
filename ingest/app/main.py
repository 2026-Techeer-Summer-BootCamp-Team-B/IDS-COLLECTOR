"""
Ingest 서비스 - 감시 시스템의 첫 관문.

역할은 딱 하나: 외부(OTel Collector, 또는 지금은 테스트용 스크립트)에서
로그를 받아서, 최대한 빨리 큐(Redis Stream)에 넣고 응답하는 것.
GeoIP 조회, 정규화, 상관분석 같은 무거운 처리는 절대 여기서 하지 않는다
(그건 Backend 서비스가 큐에서 꺼내서 처리함).

실행 방법:
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8100
"""
import json
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException

from app.redis_client import redis_client
from app.schemas import RawIngestEvent
from app.config import settings

app = FastAPI(
    title="IDS Ingest Service",
    description="WAS/Falco/K8s Audit 로그를 받아서 큐에 적재하는 전용 수집 서비스",
    version="0.1.0",
)


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.post("/ingest/raw", status_code=202)
def ingest_raw(event: RawIngestEvent):
    """
    지금 단계(OTel 준비 전)에서 쓰는 테스트용 수신 엔드포인트.

    예시 요청:
        POST /ingest/raw
        {
          "source": "was",
          "payload": {"time": "...", "remote_addr": "...", "path": "/rest/user/login", ...}
        }
    """
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
    """
    OTel Collector가 실제로 데이터를 보내오는 엔드포인트 (아직 미구현).
    팀원 쪽 OTel 설정이 끝나면, 여기서 OTLP(OpenTelemetry Protocol) 포맷을 받아서
    파싱한 뒤 위 ingest_raw와 동일하게 Redis Stream에 태우는 로직을 채울 예정.
    """
    raise HTTPException(status_code=501, detail="OTel 수신 로직은 아직 구현 전입니다.")