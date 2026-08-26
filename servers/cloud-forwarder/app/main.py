"""Cloud Audit 포워더 서비스 (P7-1).

역할: GCP Cloud Audit Logs가 내보내는 Pub/Sub 구독을 pull해서, OTel Collector의
OTLP HTTP 엔드포인트로 그대로 전달한다. 이 이후부터는 5번째 소스(cloud-audit)도
WAS/WAF/Falco/K8s Audit와 동일한 파이프라인(routing connector -> events.cloud
토픽 -> normalizer -> events.normalized)을 탄다 - servers/otel/config/otel-config.yaml,
servers/normalizer/app/normalizer.py의 normalize_cloud_audit() 참고.

FastAPI는 normalizer/correlation-engine과 같은 패턴으로 /health 체크 용도로만 쓰고,
실제 pull/forward는 app/forwarder.py의 start()가 별도 스레드에서 블로킹 방식으로
돈다(google-cloud-pubsub 클라이언트가 asyncio가 아니라 자체 스레드풀 기반이라
normalizer처럼 asyncio 태스크로 만들지 않았다 - forwarder.py 모듈 docstring 참고).
"""
import threading
from typing import Optional

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from app import forwarder

app = FastAPI(title="IDS Cloud Audit Forwarder")

_worker_thread: Optional[threading.Thread] = None


@app.on_event("startup")
def on_startup() -> None:
    """forwarder.start()가 예외로 죽으면 스레드가 그대로 종료되고, 아래 /health가
    영구히 503을 반환한다 - normalizer/app/main.py의 _consume_loop과 같은 설계:
    구독 권한 오류처럼 재시도해도 똑같이 실패할 결정적 장애를 "5초마다 재시도"로
    조용히 감추면, 겉으론 컨테이너가 떠 있어도 실제로는 아무 이벤트도 못 받는
    상태가 아무도 모르게 계속될 수 있다. 일시적 네트워크 순단은 google-cloud-pubsub
    클라이언트 자체가 내부적으로 재연결하므로(StreamingPullFuture), 여기까지
    예외가 올라온다는 건 재시도로 해결될 문제가 아니라는 뜻이라 죽은 채로 두고
    /health를 통해 드러낸다."""
    global _worker_thread
    _worker_thread = threading.Thread(target=forwarder.start, daemon=True)
    _worker_thread.start()


def _dead_thread_reason() -> Optional[str]:
    if _worker_thread is None:
        return "worker thread not started"
    if not _worker_thread.is_alive():
        return "worker thread exited"
    return None


@app.get("/health")
def health_check():
    reason = _dead_thread_reason()
    if reason:
        return JSONResponse(status_code=503, content={"status": "unhealthy", "reason": reason})
    return {"status": "ok"}
