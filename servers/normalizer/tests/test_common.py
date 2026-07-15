"""정규화 공용 헬퍼(타임스탬프 파싱, WAS 소스 IP/지속시간 계산) 단위 테스트."""
from datetime import timezone

from app.normalizer import _parse_timestamp, _was_duration_ns, _was_source_ip


class TestParseTimestamp:
    def test_iso_with_z_suffix(self):
        ts = _parse_timestamp("2026-07-15T10:00:00Z")
        assert (ts.year, ts.month, ts.day) == (2026, 7, 15)
        assert ts.tzinfo is not None

    def test_naive_iso_gets_utc_attached(self):
        ts = _parse_timestamp("2026-07-15T10:00:00")
        assert ts.tzinfo == timezone.utc

    def test_none_falls_back_to_now(self):
        ts = _parse_timestamp(None)
        assert ts.tzinfo is not None

    def test_garbage_string_falls_back_to_now_without_crashing(self):
        ts = _parse_timestamp("not-a-timestamp")
        assert ts.tzinfo is not None


class TestWasSourceIp:
    def test_xff_first_hop_preferred(self):
        payload = {"http_x_forwarded_for": "203.0.113.10, 10.0.0.1", "remote_addr": "10.0.0.2"}
        assert _was_source_ip(payload) == "203.0.113.10"

    def test_falls_back_to_remote_addr_when_no_xff(self):
        payload = {"remote_addr": "10.0.0.2"}
        assert _was_source_ip(payload) == "10.0.0.2"

    def test_alternate_xff_key_supported(self):
        payload = {"x_forwarded_for": "198.51.100.5", "remote_addr": "10.0.0.2"}
        assert _was_source_ip(payload) == "198.51.100.5"

    def test_no_ip_fields_returns_none(self):
        assert _was_source_ip({}) is None


class TestWasDurationNs:
    def test_converts_seconds_to_nanoseconds(self):
        assert _was_duration_ns({"request_time": "0.123"}) == 123_000_000

    def test_missing_request_time_returns_none(self):
        assert _was_duration_ns({}) is None

    def test_non_numeric_request_time_returns_none(self):
        assert _was_duration_ns({"request_time": "not-a-number"}) is None
