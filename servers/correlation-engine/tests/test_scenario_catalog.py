"""app/scenarios/*.yaml 카탈로그 자체의 무결성 - _load_scenarios()가 이미 강제하는
id 중복 검사(assert)에 더해, db_id 결정성과 필수 키 존재를 확인한다. YAML 오타/누락
필드는 여기서 잡히지, 프로덕션에서 evaluate()가 KeyError를 던지고 나서 잡히면 안 된다."""
import uuid

from app.main import _load_scenarios

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


def test_join_on_is_a_known_value(all_scenarios):
    # rules.py의 _join_key()가 인식하는 값 셋 - 여기 없는 값이면 join_key가 항상
    # None이 되어 그 시나리오는 조용히 영원히 발화하지 않는다.
    for s in all_scenarios:
        assert s["join_on"] in {"pod", "user_or_sa", "source_ip"}, s["id"]
