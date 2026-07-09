from typing import Any, Dict, Literal

from pydantic import BaseModel


class RawIngestEvent(BaseModel):
    """
    Ingest API가 외부(OTel, 또는 지금은 테스트용 nginx 로그)로부터 받는 원시 이벤트.

    지금 단계에서는 OTel Collector가 아직 준비 전이라, source 값으로
    "이 로그가 어디서 온 건지"만 구분해서 큐에 그대로 태운다.
    실제 정규화(공통 스키마 매핑)는 Backend 서비스가 큐에서 꺼낼 때 처리한다.
    """

    source: Literal["was", "falco", "k8s_audit"]
    payload: Dict[str, Any]  # 원본 로그를 그대로 담음 (예: nginx JSON 한 줄)