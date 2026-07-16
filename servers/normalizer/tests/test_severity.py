"""app/severity.py의 get_severity() 자체 - 소스 문자열 라우팅과 완전히 빈
payload(모든 필드 없음)에서 default 값을 쓰는지 확인한다. 세부 규칙 매칭은
test_normalize_*.py들이 실제 정규화 흐름 안에서 함께 검증한다."""
from app.severity import get_severity


def test_unknown_source_returns_baseline_severity():
    assert get_severity("unknown_source", {}) == 1


def test_was_empty_payload_uses_default():
    assert get_severity("was", {}) == 1


def test_waf_empty_payload_uses_default():
    assert get_severity("waf", {}) == 2


def test_falco_empty_payload_uses_default():
    assert get_severity("falco", {}) == 2


def test_audit_empty_payload_uses_default():
    assert get_severity("audit", {}) == 2
