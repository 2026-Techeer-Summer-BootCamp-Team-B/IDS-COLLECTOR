"""ScenarioEngine의 cardinality 타입 - join_key별 distinct_field 값의 서로 다른
개수가 threshold 이상이면 발화한다(rules.py의 _eval_cardinality). 카탈로그와 무관한
합성 시나리오로 엔진 메커니즘 자체만 검증한다(test_engine_sequence_multistage.py와
동일 방침)."""
import asyncio
from datetime import datetime, timezone

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

    async def test_only_one_concurrent_crosser_stamps_the_fired_marker(
        self, redis_client, make_event, monkeypatch
    ):
        """threshold를 넘는 순간이 여러 이벤트에 동시에 관측될 수 있는 상황
        (2026-07-21, 현재는 단일 인스턴스+순차 컨슈머라 실제로는 안 일어나지만
        스케일아웃하면 일어날 수 있는 레이스) - _eval_threshold와 동일한 SET NX
        클레임 수정을 cardinality 경로에서도 검증한다. asyncio.gather만으로는
        실제 인터리빙이 보장되지 않으므로(fakeredis 호출이 이벤트 루프에 제어를
        안 넘기면 한쪽이 끝까지 실행된 뒤에야 다른 쪽이 시작될 수 있음) SCARD
        직후 배리어로 두 호출을 강제로 맞춰서 레이스 윈도우를 결정적으로
        재현한다."""
        engine = await _engine(redis_client, _SCAN_SCENARIO)
        ip = "203.0.113.10"
        await engine.evaluate(make_event(event_module="was", source_ip=ip, url_path="/api/a"))
        await engine.evaluate(make_event(event_module="was", source_ip=ip, url_path="/api/b"))
        # distinct count는 이제 2 - threshold(3)까지 하나 남았다. 서로 다른 새
        # 값(c/d)을 동시에 넣는 두 호출 모두 자기 자신만으로 3을 채워 threshold를
        # 넘는다고 관측하게 된다.

        stamp_calls = []
        original_stamp = engine._stamp_fired_marker

        async def counting_stamp(scenario, event):
            stamp_calls.append(event.event_id)
            await original_stamp(scenario, event)

        monkeypatch.setattr(engine, "_stamp_fired_marker", counting_stamp)

        barrier = asyncio.Barrier(2)
        original_scard = redis_client.scard

        async def synced_scard(*args, **kwargs):
            result = await original_scard(*args, **kwargs)
            await barrier.wait()
            return result

        monkeypatch.setattr(redis_client, "scard", synced_scard)

        event_c = make_event(event_module="was", source_ip=ip, url_path="/api/c")
        event_d = make_event(event_module="was", source_ip=ip, url_path="/api/d")

        result_c, result_d = await asyncio.gather(
            engine._eval_cardinality(_SCAN_SCENARIO, event_c, ip),
            engine._eval_cardinality(_SCAN_SCENARIO, event_d, ip),
        )

        # 두 호출 다 이벤트를 인시던트에 반영할 수 있어야 한다(진 쪽도 "이미
        # 쿨다운 중"과 동일하게 발화 결과를 반환).
        assert result_c is not None
        assert result_d is not None
        # 하지만 "새로 발화"(집합 삭제 + 마커 스탬프)는 정확히 한쪽만 해야 한다.
        assert len(stamp_calls) == 1


_DAY_BUCKET_SCENARIO = {
    "id": "TEST-DAY-BUCKET",
    "db_id": "test-day-bucket-db-id",
    "name": "합성 day-bucket 카디널리티 테스트 시나리오 (M52)",
    "type": "cardinality",
    "join_on": "user_or_sa",
    "correlation_key_type": "user.name",
    "required_modules": ["k8s_audit"],
    "window_seconds": 604800,
    "threshold": 3,
    "cooldown_seconds": 86400,
    "distinct_field": "event_date",
    "match": {"event_module": "k8s_audit", "audit_verb": ["get", "list", "watch"]},
    "severity": 3,
    "mitre_technique_id": "T1613",
}


class TestCardinalityEventDateBucket:
    """distinct_field=event_date(2026-07-20, M52) - NormalizedEvent.event_date는
    schemas.py의 순수 @property(timestamp에서 계산)라 getattr()로 정상 동작하는지
    확인한다."""

    def _day(self, day: int) -> datetime:
        return datetime(2026, 7, day, 10, 0, 0, tzinfo=timezone.utc)

    async def test_same_day_repeated_does_not_fire(self, redis_client, make_event):
        engine = ScenarioEngine([_DAY_BUCKET_SCENARIO], redis_client)
        user = "system:serviceaccount:default:default"
        for _ in range(5):
            fired = await engine.evaluate(
                make_event(event_module="k8s_audit", audit_verb="get", user_name=user, timestamp=self._day(1))
            )
        assert fired == []

    async def test_three_distinct_days_fires(self, redis_client, make_event):
        engine = ScenarioEngine([_DAY_BUCKET_SCENARIO], redis_client)
        user = "system:serviceaccount:default:default"
        await engine.evaluate(
            make_event(event_module="k8s_audit", audit_verb="get", user_name=user, timestamp=self._day(1))
        )
        await engine.evaluate(
            make_event(event_module="k8s_audit", audit_verb="list", user_name=user, timestamp=self._day(2))
        )
        fired = await engine.evaluate(
            make_event(event_module="k8s_audit", audit_verb="watch", user_name=user, timestamp=self._day(3))
        )
        assert len(fired) == 1
        assert fired[0]["join_key"] == user
