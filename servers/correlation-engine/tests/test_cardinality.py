"""ScenarioEngine의 cardinality 타입 - join_key별 distinct_field 값의 서로 다른
개수가 threshold 이상이면 발화한다(rules.py의 _eval_cardinality). 카탈로그와 무관한
합성 시나리오로 엔진 메커니즘 자체만 검증한다(test_engine_sequence_multistage.py와
동일 방침)."""
from app.rules import ScenarioEngine

_SCAN_SCENARIO = {
    "id": "TEST-CARDINALITY",
    "db_id": "test-cardinality-db-id",
    "name": "합성 카디널리티 테스트 시나리오",
    "type": "cardinality",
    "join_on": "source_ip",
    "correlation_key_type": "source.ip",
    "required_modules": ["was"],
    "window_seconds": 60,
    "threshold": 3,
    "cooldown_seconds": 300,
    "distinct_field": "url_path",
    "match": {"event_module": "was"},
    "severity": 2,
    "mitre_technique_id": "T1595",
}


async def _engine(redis_client, *scenarios) -> ScenarioEngine:
    return ScenarioEngine(list(scenarios), redis_client)


class TestCardinalityThreshold:
    async def test_repeated_same_value_does_not_fire(self, redis_client, make_event):
        """threshold=3이어도 같은 URL만 반복되면 distinct 개수는 계속 1이라
        발화하지 않는다 - 단순 threshold(건수)와의 핵심 차이."""
        engine = await _engine(redis_client, _SCAN_SCENARIO)
        ip = "203.0.113.10"
        fired = []
        for _ in range(5):
            fired = await engine.evaluate(
                make_event(event_module="was", source_ip=ip, url_path="/api/products")
            )
        assert fired == []

    async def test_distinct_values_below_threshold_does_not_fire(self, redis_client, make_event):
        engine = await _engine(redis_client, _SCAN_SCENARIO)
        ip = "203.0.113.10"
        await engine.evaluate(make_event(event_module="was", source_ip=ip, url_path="/api/a"))
        fired = await engine.evaluate(make_event(event_module="was", source_ip=ip, url_path="/api/b"))
        assert fired == []

    async def test_distinct_values_reaching_threshold_fires(self, redis_client, make_event):
        engine = await _engine(redis_client, _SCAN_SCENARIO)
        ip = "203.0.113.10"
        await engine.evaluate(make_event(event_module="was", source_ip=ip, url_path="/api/a"))
        await engine.evaluate(make_event(event_module="was", source_ip=ip, url_path="/api/b"))
        fired = await engine.evaluate(make_event(event_module="was", source_ip=ip, url_path="/api/c"))
        assert len(fired) == 1
        assert fired[0]["join_key"] == ip
        assert fired[0]["severity"] == 2
        assert fired[0]["mitre_technique_id"] == "T1595"

    async def test_different_source_ip_has_independent_set(self, redis_client, make_event):
        engine = await _engine(redis_client, _SCAN_SCENARIO)
        await engine.evaluate(make_event(event_module="was", source_ip="203.0.113.10", url_path="/api/a"))
        await engine.evaluate(make_event(event_module="was", source_ip="203.0.113.10", url_path="/api/b"))
        fired = await engine.evaluate(
            make_event(event_module="was", source_ip="198.51.100.20", url_path="/api/c")
        )
        assert fired == []

    async def test_missing_distinct_field_value_is_ignored(self, redis_client, make_event):
        engine = await _engine(redis_client, _SCAN_SCENARIO)
        fired = await engine.evaluate(
            make_event(event_module="was", source_ip="203.0.113.10", url_path=None)
        )
        assert fired == []

    async def test_match_filter_still_applies(self, redis_client, make_event):
        """cardinality도 threshold처럼 match 조건을 먼저 통과해야 한다 - required_modules
        필터를 우회해 들어온 무관 이벤트를 걸러내는 회귀 테스트."""
        engine = await _engine(redis_client, _SCAN_SCENARIO)
        scenario_scoped_to_login = {
            **_SCAN_SCENARIO,
            "match": {"event_module": "was", "url_path_prefix": "/rest/user/login"},
        }
        engine = await _engine(redis_client, scenario_scoped_to_login)
        ip = "203.0.113.10"
        fired = await engine.evaluate(
            make_event(event_module="was", source_ip=ip, url_path="/api/products")
        )
        assert fired == []

    async def test_still_fires_during_cooldown_so_incident_stays_fresh(self, redis_client, make_event):
        engine = await _engine(redis_client, _SCAN_SCENARIO)
        ip = "203.0.113.10"
        await engine.evaluate(make_event(event_module="was", source_ip=ip, url_path="/api/a"))
        await engine.evaluate(make_event(event_module="was", source_ip=ip, url_path="/api/b"))
        first_fire = await engine.evaluate(make_event(event_module="was", source_ip=ip, url_path="/api/c"))
        assert len(first_fire) == 1

        second = await engine.evaluate(make_event(event_module="was", source_ip=ip, url_path="/api/d"))
        assert len(second) == 1
