"""app/rules.py의 _match_* 순수 함수 + _matches() 조합 로직 단위 테스트.
Redis/이벤트 스트림 없이 매칭 규칙만 검증한다."""
from app.rules import (
    _match_any_flag,
    _match_min_severity,
    _match_prefix,
    _match_value,
    _matches,
)


class TestMatchValue:
    def test_single_value_equal(self):
        assert _match_value("create", "create") is True

    def test_single_value_not_equal(self):
        assert _match_value("delete", "create") is False

    def test_list_value_membership(self):
        assert _match_value("kube-system", ["kube-system", "kube-public"]) is True
        assert _match_value("default", ["kube-system", "kube-public"]) is False

    def test_none_actual_never_matches_scalar(self):
        assert _match_value(None, "create") is False


class TestMatchAnyFlag:
    def test_overlap_true(self):
        assert _match_any_flag(["privileged", "host_pid"], ["privileged"]) is True

    def test_no_overlap_false(self):
        assert _match_any_flag(["wildcard_verb"], ["privileged", "host_pid"]) is False

    def test_none_actual_treated_as_empty(self):
        assert _match_any_flag(None, ["privileged"]) is False

    def test_wanted_scalar_is_wrapped_in_list(self):
        # S17처럼 wanted가 리스트가 아니라 단일 문자열("NodePort")로 오는 케이스
        assert _match_any_flag(["NodePort"], "NodePort") is True


class TestMatchPrefix:
    def test_prefix_match(self):
        assert _match_prefix("/rest/user/login", "/rest/user/login") is True
        assert _match_prefix("/rest/user/login/reset", "/rest/user/login") is True

    def test_prefix_no_match(self):
        assert _match_prefix("/rest/products", "/rest/user/login") is False

    def test_none_actual_does_not_crash(self):
        assert _match_prefix(None, "/rest/user/login") is False


class TestMatchMinSeverity:
    def test_meets_minimum(self):
        assert _match_min_severity(4, 4) is True
        assert _match_min_severity(4, 3) is True

    def test_below_minimum(self):
        assert _match_min_severity(2, 4) is False


class TestMatches:
    def test_empty_pattern_always_matches(self, make_event):
        event = make_event(event_module="was")
        assert _matches(event, {}) is True

    def test_all_conditions_must_hold(self, make_event):
        pattern = {"event_module": "k8s_audit", "audit_verb": "delete"}
        matching = make_event(event_module="k8s_audit", audit_verb="delete")
        wrong_verb = make_event(event_module="k8s_audit", audit_verb="create")
        assert _matches(matching, pattern) is True
        assert _matches(wrong_verb, pattern) is False

    def test_key_absent_from_pattern_is_not_checked(self, make_event):
        # pattern에 없는 키(예: user_name)는 검사 대상이 아니다
        pattern = {"event_module": "was"}
        event = make_event(event_module="was", user_name="whatever")
        assert _matches(event, pattern) is True
