"""app/scenarios/*.yaml 카탈로그 자체의 무결성 - _load_scenarios()가 이미 강제하는
id 중복 검사(assert)에 더해, db_id 결정성과 필수 키 존재를 확인한다. YAML 오타/누락
필드는 여기서 잡히지, 프로덕션에서 evaluate()가 KeyError를 던지고 나서 잡히면 안 된다."""
import re
import uuid

from app.main import _load_scenarios
from app.rules import _RECENCY_MARKER_TTL_SECONDS, _stage_patterns

_STAGE_KEY_RE = re.compile(r"^stage(\d+)$")

_REQUIRED_KEYS = {"id", "name", "type", "join_on", "correlation_key_type", "required_modules"}


def test_at_least_30_scenarios_load(all_scenarios):
    assert len(all_scenarios) >= 30


def test_scenario_ids_are_unique(all_scenarios):
    ids = [s["id"] for s in all_scenarios]
    assert len(ids) == len(set(ids))


def test_db_id_is_deterministic_across_reloads(all_scenarios):
    """correlation-engine 재시작 시(app/main.py의 _scenario_reload_loop 포함)마다
    같은 코드(S1/S2/...)가 항상 같은 UUID로 매핑돼야 Postgres UPSERT가 중복
    insert 없이 같은 행을 갱신한다."""
    reloaded = _load_scenarios()
    by_id = {s["id"]: s["db_id"] for s in all_scenarios}
    for s in reloaded:
        assert s["db_id"] == by_id[s["id"]]
        assert s["db_id"] == str(uuid.uuid5(uuid.NAMESPACE_OID, f"scenario:{s['id']}"))


def test_every_scenario_has_required_keys(all_scenarios):
    for s in all_scenarios:
        missing = _REQUIRED_KEYS - s.keys()
        assert not missing, f"{s.get('id')}에 필수 키 누락: {missing}"


def test_threshold_scenarios_have_threshold_window_and_match(all_scenarios):
    for s in all_scenarios:
        if s["type"] == "threshold":
            assert "threshold" in s, s["id"]
            assert "window_seconds" in s, s["id"]
            assert "match" in s, s["id"]


def test_sequence_scenarios_have_both_stages(all_scenarios):
    for s in all_scenarios:
        if s["type"] == "sequence":
            assert "stage1" in s, s["id"]
            assert "stage2" in s, s["id"]
            assert "window_seconds" in s, s["id"]


def test_sequence_scenarios_do_not_skip_stage_numbers(all_scenarios):
    """rules.py의 _stage_patterns()는 stageN 키를 숫자 순서로만 정렬하지, 번호가
    연속인지는 확인하지 않는다(2026-07-19, 단계 수 제한을 없애면서 그 검증 책임을
    여기 카탈로그 무결성 테스트로 옮김) - stage3 없이 stage4만 있으면 실제로는
    2단계(stage1->stage2)인데 stage4가 "3번째 자리"에 잘못 끼어들어가 의도치 않게
    3단계 시퀀스로 평가된다. 번호가 1부터 빈 자리 없이 연속인지 여기서 강제한다."""
    for s in all_scenarios:
        if s["type"] == "sequence":
            numbers = sorted(int(m.group(1)) for key in s if (m := _STAGE_KEY_RE.match(key)))
            assert numbers == list(range(1, len(numbers) + 1)), (
                f"{s['id']}: stage 번호가 1부터 연속이 아님: {numbers}"
            )


def test_join_on_is_a_known_value(all_scenarios):
    # rules.py의 _join_key()가 인식하는 값 셋 - 여기 없는 값이면 join_key가 항상
    # None이 되어 그 시나리오는 조용히 영원히 발화하지 않는다.
    for s in all_scenarios:
        assert s["join_on"] in {"pod", "user_or_sa", "source_ip"}, s["id"]


def test_scenario_type_is_known(all_scenarios):
    # rules.py의 evaluate() 타입 분기가 인식하는 값 셋 - 여기 없는 값이면 threshold도
    # cardinality도 아니라서 조용히 _eval_sequence로 떨어져(else 분기) stage1/stage2가
    # 없다는 이유로 IndexError가 난다.
    for s in all_scenarios:
        assert s["type"] in {"threshold", "sequence", "cardinality"}, s["id"]


def test_cardinality_scenarios_have_threshold_window_match_and_distinct_field(all_scenarios):
    for s in all_scenarios:
        if s["type"] == "cardinality":
            assert "threshold" in s, s["id"]
            assert "window_seconds" in s, s["id"]
            assert "match" in s, s["id"]
            assert "distinct_field" in s, s["id"]


def test_absent_recent_seconds_does_not_exceed_recency_marker_ttl(all_scenarios):
    """absent_recent_seconds(또는 window_seconds 기본값)가 rules.py의
    _RECENCY_MARKER_TTL_SECONDS를 넘으면, _stamp_recency()가 남긴 마커가 그 시간이
    되기 전에 먼저 Redis에서 만료돼 "최근에 없었다"고 오판할 수 있다 - 실제로는
    있었는데 마커만 사라진 거짓 부재를 카탈로그 로드 단계에서 막는다."""
    for s in all_scenarios:
        window = s.get("window_seconds")
        patterns = list(_stage_patterns(s))
        if "match" in s:
            patterns.append(s["match"])
        for pattern in patterns:
            if "absent_recent_module" not in pattern:
                continue
            seconds = pattern.get("absent_recent_seconds", window)
            assert seconds <= _RECENCY_MARKER_TTL_SECONDS, (
                f"{s['id']}: absent_recent_seconds({seconds}) > "
                f"_RECENCY_MARKER_TTL_SECONDS({_RECENCY_MARKER_TTL_SECONDS})"
            )
