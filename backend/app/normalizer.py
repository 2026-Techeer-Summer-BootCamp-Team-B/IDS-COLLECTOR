"""
Redis Stream에서 꺼낸 원시 이벤트({"source": ..., "payload": {...}})를
공통 스키마(AttackLog)로 변환하는 모듈.

지금은 "was"(Nginx access log) 소스만 구현되어 있고,
falco/k8s_audit은 팀원이 해당 로그 소스를 완성하는 대로 이어서 채울 예정.
"""
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from app.schemas import AttackLog


def _severity_from_status(status: Optional[int]) -> int:
    """
    HTTP 상태 코드를 기준으로 한 아주 단순한 심각도 추정.
    ⚠️ 이건 임시 휴리스틱이다 - 실제 "공격인지 아닌지"를 판단하는 게 아니라
    "일단 심각도 필드를 채워두는" 용도. 나중에 상관분석/시그니처 판단 로직으로
    교체되어야 한다 (팀 문서의 "심각도 매핑" 시트가 최종 기준).
    """
    if status is None:
        return 1
    if status in (401, 403):
        return 3  # 인증/인가 실패는 눈여겨봐야 할 신호
    if status >= 500:
        return 2
    if status >= 400:
        return 2
    return 1


def normalize_was(payload: Dict[str, Any]) -> AttackLog:
    """Nginx access log(JSON) 한 줄을 AttackLog로 변환."""
    status = payload.get("status")

    return AttackLog(
        **{
            "@timestamp": payload.get("time") or datetime.now(timezone.utc).isoformat(),
            "event_id": str(uuid.uuid4()),
            "event_module": "was",
            "event_kind": "event",
            "event_action": f'{payload.get("method", "")} {payload.get("path", "")}'.strip(),
            "event_outcome": "success" if (status and status < 400) else "failure",
            "event_severity": _severity_from_status(status),
            "event_original": json.dumps(payload, ensure_ascii=False),
            "source_ip": payload.get("remote_addr"),
            "http_request_method": payload.get("method"),
            "url_path": payload.get("path"),
            "http_response_status_code": status,
            "user_agent_original": payload.get("user_agent"),
        }
    )


def normalize(source: str, payload: Dict[str, Any]) -> Optional[AttackLog]:
    """source에 따라 알맞은 정규화 함수로 라우팅."""
    if source == "was":
        return normalize_was(payload)

    # TODO: falco, k8s_audit 소스가 준비되면 각각의 normalize_falco / normalize_k8s_audit 추가
    return None