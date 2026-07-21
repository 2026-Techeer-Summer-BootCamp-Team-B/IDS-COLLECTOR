"""_consume_loop이 Kafka 메시지 value를 디코딩하는 순수 함수 부분의 단위 테스트.

json.JSONDecodeError만 잡던 예전 코드는 msg.value가 None(tombstone)이거나 UTF-8이
아닌 바이트일 때(UnicodeDecodeError) 잡히지 않은 예외로 컨슈머 태스크를 죽여
파이프라인을 통째로 멈췄다(2026-07-21) - 이 테스트는 그 회귀를 잡는다."""
import json

import pytest

from app.main import _decode_kafka_message


class TestDecodeKafkaMessage:
    def test_valid_json_bytes_decodes_to_dict(self):
        value = json.dumps({"resourceLogs": []}).encode("utf-8")
        assert _decode_kafka_message(value) == {"resourceLogs": []}

    def test_none_value_raises_value_error(self):
        with pytest.raises(ValueError):
            _decode_kafka_message(None)

    def test_invalid_utf8_bytes_raises_unicode_decode_error(self):
        invalid_utf8 = b"\xff\xfe\x00\x01"
        with pytest.raises(UnicodeDecodeError):
            _decode_kafka_message(invalid_utf8)

    def test_malformed_json_raises_json_decode_error(self):
        with pytest.raises(json.JSONDecodeError):
            _decode_kafka_message(b"{not valid json")
