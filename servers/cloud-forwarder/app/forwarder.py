"""GCP Pub/Sub 구독 -> OTel Collector(OTLP HTTP) 전달 (P7-1).

google-cloud-pubsub의 표준 사용법은 콜백 기반 스트리밍 pull(`subscriber.subscribe()`)로,
호출한 스레드를 블로킹하지 않고 내부적으로 별도 gRPC 스트림 + 스레드풀에서 콜백을
실행한다. 이 서비스는 이벤트 루프가 필요한 다른 부분이 없어서(단순 전달만 함) asyncio로
다시 감싸지 않고, main.py가 이 모듈의 start()를 그냥 백그라운드 스레드 하나에 태워
돌린다 - normalizer/correlation-engine처럼 asyncio 컨슈머 루프를 쓰지 않는 이유.

WAS/WAF/Falco/K8s Audit 4개 소스는 전부 Target 쪽 otel-collector가 body를 문자열로
그대로 push하는 구조라(normalizer/app/main.py의 _body_to_payload 주석 참고), 이 서비스도
같은 관례를 따른다 - Pub/Sub 메시지(GCP Cloud Audit Log LogEntry, JSON) 원문을 파싱하지
않고 문자열 그대로 OTLP body에 담아 보낸다. 실제 파싱은 normalizer/app/normalizer.py의
normalize_cloud_audit()이 한다 - 이 서비스는 "형식을 안 바꾸고 옮기기만" 하는 순수
포워더로 남겨서, GCP가 LogEntry 스키마를 바꿔도 여기가 아니라 normalizer 쪽 파서만
고치면 되게 한다.
"""
import time
from typing import NoReturn

import httpx
from google.cloud import pubsub_v1

from app.config import settings

# Pub/Sub 클라이언트가 콜백을 여러 워커 스레드에서 동시에 호출할 수 있어서, 커넥션
# 재사용을 위해 클라이언트 하나를 모듈 레벨에서 공유한다(httpx.Client는 스레드 세이프).
_http_client = httpx.Client(timeout=10.0)


def _now_unix_nano() -> str:
    return str(time.time_ns())


def _build_otlp_payload(raw_message: str) -> dict:
    """Pub/Sub 메시지 원문(str) 하나를 OTLP JSON(ExportLogsServiceRequest) 한 건으로
    감싼다. normalizer/app/main.py의 _iter_log_records/_any_value_to_python이 이
    구조(body.stringValue)를 그대로 파싱할 수 있다 - Target 쪽 otel-collector가
    보내는 형태와 동일한 규격을 맞춘 것."""
    now = _now_unix_nano()
    return {
        "resourceLogs": [
            {
                "resource": {
                    "attributes": [
                        {
                            "key": "log.source",
                            "value": {"stringValue": settings.log_source_tag},
                        }
                    ]
                },
                "scopeLogs": [
                    {
                        "logRecords": [
                            {
                                "timeUnixNano": now,
                                "observedTimeUnixNano": now,
                                "body": {"stringValue": raw_message},
                            }
                        ]
                    }
                ],
            }
        ]
    }


def _forward(raw_message: str) -> None:
    payload = _build_otlp_payload(raw_message)
    response = _http_client.post(settings.otlp_http_endpoint, json=payload)
    response.raise_for_status()


def _make_callback():
    def callback(message: "pubsub_v1.subscriber.message.Message") -> None:
        try:
            _forward(message.data.decode("utf-8"))
        except Exception as e:
            # 여기서 실패하면 ack하지 않는다 - Pub/Sub이 ack 데드라인 이후 같은
            # 메시지를 다시 보내므로(at-least-once), Collector/Kafka가 잠깐
            # 죽어도 재시도로 흡수된다. normalizer의 dedupe(insertId 기반, P7-1)가
            # 재전송으로 인한 중복을 흡수한다.
            print(f"[cloud-forwarder] 전달 실패, ack 보류 (재전송 예정): {e}")
            return
        message.ack()

    return callback


def start() -> NoReturn:
    """스트리밍 pull을 시작하고 프로세스가 죽을 때까지 블로킹한다. main.py가 이
    함수를 별도 스레드에서 호출한다."""
    subscriber = pubsub_v1.SubscriberClient()
    subscription_path = subscriber.subscription_path(
        settings.gcp_project_id, settings.gcp_pubsub_subscription
    )

    print(f"[cloud-forwarder] 구독 시작 - {subscription_path}")
    future = subscriber.subscribe(subscription_path, callback=_make_callback())

    with subscriber:
        try:
            future.result()
        except Exception as e:
            print(f"[cloud-forwarder] 구독 스트림 종료됨, 재시작 필요: {e}")
            raise
