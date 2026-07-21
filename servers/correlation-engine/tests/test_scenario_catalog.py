"""app/scenarios/*.yaml 카탈로그 자체의 무결성 - _load_scenarios()가 이미 강제하는
id 중복 검사(assert)에 더해, db_id 결정성과 필수 키 존재를 확인한다. YAML 오타/누락
필드는 여기서 잡히지, 프로덕션에서 evaluate()가 KeyError를 던지고 나서 잡히면 안 된다."""
import re
import uuid

from app.main import _load_scenarios
from app.rules import _RECENCY_MARKER_TTL_SECONDS, _stage_patterns
from ids_shared.mitre_mapping import tactics_for_technique

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
        assert s["join_on"] in {"pod", "user_or_sa", "source_ip", "rule_id"}, s["id"]


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


def test_requires_recent_seconds_does_not_exceed_recency_marker_ttl(all_scenarios):
    """absent_recent_seconds와 동일한 이유(rules.py의 requires_recent_fire 섹션
    참고) - requires_recent_seconds(또는 window_seconds 기본값)가
    _RECENCY_MARKER_TTL_SECONDS를 넘으면 _stamp_fired_marker()가 남긴 마커가 그
    전에 먼저 만료돼 실제로는 선행 발화가 있었는데 "없었다"고 오판할 수 있다."""
    for s in all_scenarios:
        window = s.get("window_seconds")
        patterns = list(_stage_patterns(s))
        if "match" in s:
            patterns.append(s["match"])
        for pattern in patterns:
            if "requires_recent_fire" not in pattern:
                continue
            seconds = pattern.get("requires_recent_seconds", window)
            assert seconds <= _RECENCY_MARKER_TTL_SECONDS, (
                f"{s['id']}: requires_recent_seconds({seconds}) > "
                f"_RECENCY_MARKER_TTL_SECONDS({_RECENCY_MARKER_TTL_SECONDS})"
            )


def test_mitre_technique_id_resolves_to_nonempty_tactics(all_scenarios):
    """시나리오가 mitre_technique_id를 적어뒀는데 ids_shared/mitre_mapping.py
    (CONTAINERS_MATRIX/SCENARIO_TACTIC_OVERRIDE) 양쪽 다에 없으면
    tactics_for_technique()가 조용히 빈 리스트를 반환한다 - 그 시나리오가 발화한
    인시던트는 mitre_tactics가 항상 빈 배열로 저장되고 platform-api의
    /attck/coverage에서도 누락된다(S106/T1531이 실제로 이렇게 됐다가
    2026-07-21에 뒤늦게 발견됨 - 새 시나리오를 추가할 때 매핑 채우는 걸
    깜빡해도 여기서 바로 잡히게 한다)."""
    for s in all_scenarios:
        technique_id = s.get("mitre_technique_id")
        if not technique_id:
            continue
        assert tactics_for_technique(technique_id), (
            f"{s['id']}: mitre_technique_id={technique_id!r}가 "
            "ids_shared/mitre_mapping.py의 CONTAINERS_MATRIX/SCENARIO_TACTIC_OVERRIDE "
            "어디에도 없어 tactics_for_technique()가 빈 리스트를 반환함"
        )


def test_requires_recent_fire_references_a_scenario_that_stamps_the_same_axis(all_scenarios):
    """requires_recent_fire가 가리키는 scenario id는 (1) 실제로 카탈로그에
    존재해야 하고, (2) stamps_fired_marker=true여야 마커를 남기며, (3) 그 마커의
    축(scenario.get("fired_marker_join_on", scenario["join_on"]))이 소비 쪽
    시나리오 자신의 join_on과 정확히 일치해야 한다 - rules.py의
    _passes_requires_recent_fire는 항상 소비 쪽 자신의 join_on으로만 조회하므로
    (모듈 docstring의 requires_recent_fire 섹션 참고), 축이 어긋나면 조건이
    조용히 영원히 불충족돼 그 패턴은 절대 매칭되지 않는다(죽은 코드가 조용히
    묻히는 걸 카탈로그 로드 단계에서 막는다)."""
    by_id = {s["id"]: s for s in all_scenarios}
    for s in all_scenarios:
        patterns = list(_stage_patterns(s))
        if "match" in s:
            patterns.append(s["match"])
        for pattern in patterns:
            required = pattern.get("requires_recent_fire")
            if not required:
                continue
            if isinstance(required, str):
                required = [required]
            for producer_id in required:
                producer = by_id.get(producer_id)
                assert producer is not None, (
                    f"{s['id']}: requires_recent_fire가 가리키는 {producer_id!r}가 "
                    "카탈로그에 없음"
                )
                assert producer.get("stamps_fired_marker"), (
                    f"{s['id']}: requires_recent_fire가 가리키는 {producer_id!r}는 "
                    "stamps_fired_marker=true가 아니라 마커를 절대 남기지 않음"
                )
                marker_axis = producer.get("fired_marker_join_on", producer["join_on"])
                assert marker_axis == s["join_on"], (
                    f"{s['id']}(join_on={s['join_on']!r})가 요구하는 "
                    f"{producer_id!r}의 마커 축은 {marker_axis!r}이라 서로 어긋남 - "
                    f"{producer_id!r}에 fired_marker_join_on: {s['join_on']!r}을 "
                    "추가할 것"
                )
