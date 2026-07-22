"""normalizer 테스트 공용 픽스처.

실행 방법:
    cd servers/normalizer
    pip install -r requirements-dev.txt
    pytest

normalize_was/normalize_waf/normalize_falco/normalize_audit은 전부 순수 함수
(원본 payload dict -> NormalizedEvent)라 Kafka/Redis 없이 그대로 호출해서
검증한다. severity.yaml도 app/severity.py가 앱 기동과 동일한 경로(app 패키지
기준 상대경로)로 실제 프로덕션 파일을 그대로 읽으므로, 테스트 전용 사본이 아니라
실제 배포되는 심각도 매핑 기준으로 오분류를 잡는다.
"""
from typing import Any, Dict

import pytest


@pytest.fixture
def base_was_log():
    """nginx-was-logger가 남기는 JSON access log 한 줄의 최소 골격."""

    def _make(**overrides: Any) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "time": "2026-07-15T10:00:00Z",
            "method": "GET",
            "path": "/rest/products",
            "query": "",
            "status": 200,
            "remote_addr": "192.0.2.1",
            "referrer": "-",
            "body_bytes_sent": 1234,
            "user_agent": "Mozilla/5.0",
            "request_time": "0.123",
        }
        payload.update(overrides)
        return payload

    return _make


@pytest.fixture
def base_waf_alert():
    """WafAlert 센서 스펙 최소 골격."""

    def _make(**overrides: Any) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            # WafAlert(Techeer-12th-b/backend/app/models/schemas.py)의 실제 wire
            # 필드명은 "timestamp"다 - WAS의 "time"과 다르다(2026-07-21, 이 픽스처가
            # "time"으로 잘못 돼 있던 게 normalize_waf의 동일한 버그를 들키지 않게
            # 가리고 있었다).
            "timestamp": "2026-07-15T10:00:00Z",
            "attack_type": "sql_injection",
            "risk_level": "MEDIUM",
            "matched_rule_id": "sqli_union_select",
            "matched_rule_name": "SQL Injection: UNION SELECT",
            "payload_snippet": "' UNION SELECT * FROM users--",
            "target_endpoint": "/rest/products/search",
            "http_method": "GET",
            "user_agent": "sqlmap/1.7",
            "blocked": True,
            "mode": "prevention",
            "source_ip": "203.0.113.10",
        }
        payload.update(overrides)
        return payload

    return _make


@pytest.fixture
def base_falco_event():
    """Falco json_output 최소 골격. output_fields는 별도 인자로 받아 통째로
    교체할 수 있게 한다(다른 필드처럼 update로 부분 병합하면 실제 페이로드처럼
    "언급 안 한 키는 아예 없음" 상태를 재현하기 어렵다)."""

    def _make(output_fields: Dict[str, Any] = None, **overrides: Any) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "time": "2026-07-15T10:00:00Z",
            "rule": "Terminal shell in container",
            "priority": "Warning",
            "tags": ["container", "shell"],
        }
        payload.update(overrides)
        payload["output_fields"] = output_fields if output_fields is not None else {}
        return payload

    return _make


@pytest.fixture
def base_audit_event():
    """kube-apiserver audit 이벤트(audit.k8s.io/v1) 최소 골격 - main.py가 이미
    stage=="ResponseComplete"만 골라 normalize_audit까지 보내주므로 그 상태를
    기본값으로 둔다."""

    def _make(**overrides: Any) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "stage": "ResponseComplete",
            "stageTimestamp": "2026-07-15T10:00:00.000000Z",
            "verb": "get",
            "objectRef": {"resource": "pods", "namespace": "default", "name": "app-1"},
            "responseStatus": {"code": 200},
            "sourceIPs": ["192.0.2.1"],
            "user": {"username": "alice", "groups": ["system:authenticated"]},
        }
        payload.update(overrides)
        return payload

    return _make
