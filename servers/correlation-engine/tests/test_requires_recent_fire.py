"""ScenarioEngine의 "선행 발화" 확인(requires_recent_fire) - absent_recent_module의
정반대(부재가 아니라 존재를 요구)로, 다른 시나리오가 (소비 쪽 자신의 join_on 축으로)
최근 실제 발화(stamps_fired_marker)한 적이 있어야 이 패턴을 매칭으로 친다(rules.py의
_stamp_fired_marker/_passes_requires_recent_fire/_stage_matches). 카탈로그와 무관한
합성 시나리오로 엔진 메커니즘 자체만 검증한다(test_absent_recency.py와 동일 방침) -
discovery.yaml의 S92(카디널리티 정찰, join_on=source_ip, fired_marker_join_on=pod로
축 override)->S93(Falco 민감 파일 접근, join_on=pod) 조합이 "축이 다른" 실제 사용
예시고, S31(join_on=user_or_sa)->S62(join_on=user_or_sa)가 "축이 같아 override가
필요 없는" 실제 사용 예시다."""
from datetime import datetime, timedelta, timezone

from app.rules import ScenarioEngine

_RECON_SCENARIO = {
    "id": "TEST-RECON",
    "db_id": "test-recon-db-id",
    "name": "합성 정찰 카디널리티 테스트 시나리오",
    "type": "cardinality",
    "join_on": "source_ip",
    "correlation_key_type": "source.ip",
    "required_modules": ["was"],
    "window_seconds": 60,
    "threshold": 3,
    "cooldown_seconds": 300,
    "distinct_field": "url_path",
    "stamps_fired_marker": True,
    # 자기 축(source_ip)이 아니라 소비 쪽(_BREACH_SCENARIO, join_on=pod)이 실제로
    # 조회할 축으로 override - S92와 같은 이유(자기 축과 소비 쪽 축이 다른 경우).
    "fired_marker_join_on": "pod",
    "match": {"event_module": "was"},
    "severity": 2,
    "mitre_technique_id": "T1595",
}

_BREACH_SCENARIO = {
    "id": "TEST-BREACH",
    "db_id": "test-breach-db-id",
    "name": "합성 침해 확정 테스트 시나리오",
    "type": "threshold",
    "join_on": "pod",
    "correlation_key_type": "orchestrator.resource.name",
    "required_modules": ["falco"],
    "window_seconds": 300,
    "threshold": 1,
    "cooldown_seconds": 600,
    "match": {
        "event_module": "falco",
        "event_action": "Read sensitive file untrusted",
        "requires_recent_fire": "TEST-RECON",
    },
    "severity": 4,
    "mitre_technique_id": "T1552",
}


async def _engine(redis_client, *scenarios) -> ScenarioEngine:
    return ScenarioEngine(list(scenarios), redis_client)


async def _fire_recon(engine, make_event, ip: str, pod: str, timestamp=None):
    """threshold=3에 도달하도록 서로 다른 url_path 3개로 정찰 시나리오를 발화시킨다."""
    kwargs = {"timestamp": timestamp} if timestamp is not None else {}
    for path in ("/api/a", "/api/b", "/api/c"):
        fired = await engine.evaluate(
            make_event(
                event_module="was",
                source_ip=ip,
                url_path=path,
                orchestrator_resource_name=pod,
                **kwargs,
            )
        )
    return fired


class TestRequiresRecentFire:
    async def test_fires_when_producer_recently_fired_on_same_pod(self, redis_client, make_event):
        engine = await _engine(redis_client, _RECON_SCENARIO, _BREACH_SCENARIO)
        pod = "juice-shop-abc"
        recon_fired = await _fire_recon(engine, make_event, ip="203.0.113.10", pod=pod)
        assert len(recon_fired) == 1

        fired = await engine.evaluate(
            make_event(
                event_module="falco",
                event_action="Read sensitive file untrusted",
                orchestrator_resource_name=pod,
            )
        )
        assert len(fired) == 1
        assert fired[0]["scenario_name"] == "합성 침해 확정 테스트 시나리오"

    async def test_does_not_fire_without_producer_firing(self, redis_client, make_event):
        engine = await _engine(redis_client, _RECON_SCENARIO, _BREACH_SCENARIO)
        fired = await engine.evaluate(
            make_event(
                event_module="falco",
                event_action="Read sensitive file untrusted",
                orchestrator_resource_name="juice-shop-abc",
            )
        )
        assert fired == []

    async def test_producer_firing_on_different_pod_does_not_satisfy(self, redis_client, make_event):
        engine = await _engine(redis_client, _RECON_SCENARIO, _BREACH_SCENARIO)
        await _fire_recon(engine, make_event, ip="203.0.113.10", pod="pod-scanned")
        fired = await engine.evaluate(
            make_event(
                event_module="falco",
                event_action="Read sensitive file untrusted",
                orchestrator_resource_name="pod-other",
            )
        )
        assert fired == []

    async def test_producer_without_stamps_fired_marker_never_satisfies(self, redis_client, make_event):
        """stamps_fired_marker가 없는(기본 False) 시나리오는 발화해도 마커를
        남기지 않는다 - opt-in이라는 게 핵심."""
        silent_recon = {**_RECON_SCENARIO, "stamps_fired_marker": False}
        engine = await _engine(redis_client, silent_recon, _BREACH_SCENARIO)
        pod = "juice-shop-abc"
        recon_fired = await _fire_recon(engine, make_event, ip="203.0.113.10", pod=pod)
        assert len(recon_fired) == 1

        fired = await engine.evaluate(
            make_event(
                event_module="falco",
                event_action="Read sensitive file untrusted",
                orchestrator_resource_name=pod,
            )
        )
        assert fired == []

    async def test_marker_ages_out_after_requires_recent_seconds(self, redis_client, make_event):
        """requires_recent_seconds를 override해서, 그 시간보다 더 전에 발화한
        마커는 더 이상 "최근"으로 안 쳐야 한다 - 이벤트의 timestamp를 직접 제어해서
        실제로 sleep하지 않고 결정적으로 검증한다(test_absent_recency.py의 동명
        테스트와 동일 기법)."""
        breach_scenario = {
            **_BREACH_SCENARIO,
            "match": {**_BREACH_SCENARIO["match"], "requires_recent_seconds": 30},
        }
        engine = await _engine(redis_client, _RECON_SCENARIO, breach_scenario)
        pod = "juice-shop-abc"
        base = datetime.now(timezone.utc)

        recon_fired = await _fire_recon(engine, make_event, ip="203.0.113.10", pod=pod, timestamp=base)
        assert len(recon_fired) == 1

        later_falco = make_event(
            event_module="falco",
            event_action="Read sensitive file untrusted",
            orchestrator_resource_name=pod,
            timestamp=base + timedelta(seconds=31),
        )
        fired = await engine.evaluate(later_falco)
        assert fired == []

    async def test_marker_still_fresh_within_requires_recent_seconds(self, redis_client, make_event):
        breach_scenario = {
            **_BREACH_SCENARIO,
            "match": {**_BREACH_SCENARIO["match"], "requires_recent_seconds": 30},
        }
        engine = await _engine(redis_client, _RECON_SCENARIO, breach_scenario)
        pod = "juice-shop-abc"
        base = datetime.now(timezone.utc)

        recon_fired = await _fire_recon(engine, make_event, ip="203.0.113.10", pod=pod, timestamp=base)
        assert len(recon_fired) == 1

        later_falco = make_event(
            event_module="falco",
            event_action="Read sensitive file untrusted",
            orchestrator_resource_name=pod,
            timestamp=base + timedelta(seconds=29),
        )
        fired = await engine.evaluate(later_falco)
        assert len(fired) == 1

    async def test_requires_recent_fire_accepts_list_and_all_must_be_satisfied(self, redis_client, make_event):
        # match를 좁혀서 _fire_recon()이 보내는 /api/a,b,c 이벤트로는 이 시나리오가
        # 절대 채워지지 않게 한다 - "목록 중 하나만 충족됐다"는 상태를 만들기 위함
        # (원래 _RECON_SCENARIO와 match까지 동일하면 같은 이벤트로 둘 다 같이
        # 발화해버려서 이 테스트가 검증하려는 "부분 충족"을 재현할 수 없다).
        other_producer = {
            **_RECON_SCENARIO,
            "id": "TEST-RECON-2",
            "db_id": "test-recon-2-db-id",
            "match": {"event_module": "was", "url_path_prefix": "/admin"},
        }
        breach_scenario = {
            **_BREACH_SCENARIO,
            "match": {
                **_BREACH_SCENARIO["match"],
                "requires_recent_fire": ["TEST-RECON", "TEST-RECON-2"],
            },
        }
        engine = await _engine(redis_client, _RECON_SCENARIO, other_producer, breach_scenario)
        pod = "juice-shop-abc"

        await _fire_recon(engine, make_event, ip="203.0.113.10", pod=pod)
        # TEST-RECON-2는 아직 발화하지 않음 - 목록 중 하나만 충족된 상태
        fired = await engine.evaluate(
            make_event(
                event_module="falco",
                event_action="Read sensitive file untrusted",
                orchestrator_resource_name=pod,
            )
        )
        assert fired == []

    async def test_pattern_without_requires_recent_fire_is_unaffected(self, redis_client, make_event):
        """requires_recent_fire가 없는 일반 패턴은 마커 존재 여부와 무관하게
        그대로 동작해야 한다 - 기존 threshold/cardinality 회귀 방지."""
        plain_scenario = {
            **_BREACH_SCENARIO,
            "id": "TEST-BREACH-PLAIN",
            "match": {"event_module": "falco", "event_action": "Read sensitive file untrusted"},
        }
        engine = await _engine(redis_client, plain_scenario)
        fired = await engine.evaluate(
            make_event(
                event_module="falco",
                event_action="Read sensitive file untrusted",
                orchestrator_resource_name="juice-shop-abc",
            )
        )
        assert len(fired) == 1


# S31(join_on=user_or_sa)->S62(join_on=user_or_sa) 패턴 - 공급/소비가 같은 축을
# 쓰므로 fired_marker_join_on override가 필요 없다(생략하면 공급 쪽 자신의 join_on을
# 그대로 쓴다). 축이 다른 위 TestRequiresRecentFire(source_ip->pod)와 대비된다.
_SAME_AXIS_PRODUCER = {
    "id": "TEST-RBAC-ENUM",
    "db_id": "test-rbac-enum-db-id",
    "name": "합성 RBAC 열거 테스트 시나리오",
    "type": "threshold",
    "join_on": "user_or_sa",
    "correlation_key_type": "user.name",
    "required_modules": ["k8s_audit"],
    "window_seconds": 60,
    "threshold": 5,
    "cooldown_seconds": 300,
    "stamps_fired_marker": True,
    "match": {"event_module": "k8s_audit", "audit_verb": ["get", "list"]},
    "severity": 2,
    "mitre_technique_id": "T1069",
}

_SAME_AXIS_CONSUMER = {
    "id": "TEST-RBAC-THEN-SECRETS",
    "db_id": "test-rbac-then-secrets-db-id",
    "name": "합성 RBAC 열거 이후 시크릿 접근 테스트 시나리오",
    "type": "threshold",
    "join_on": "user_or_sa",
    "correlation_key_type": "user.name",
    "required_modules": ["k8s_audit"],
    "window_seconds": 1800,
    "threshold": 1,
    "cooldown_seconds": 1800,
    "match": {
        "event_module": "k8s_audit",
        "event_action": "get secrets",
        "requires_recent_fire": "TEST-RBAC-ENUM",
    },
    "severity": 4,
    "mitre_technique_id": "T1069",
}


class TestRequiresRecentFireDefaultsToOwnJoinOnWhenAxesMatch:
    async def test_fires_after_producer_threshold_reached_on_same_user(self, redis_client, make_event):
        engine = await _engine(redis_client, _SAME_AXIS_PRODUCER, _SAME_AXIS_CONSUMER)
        user = "attacker@example.com"
        for _ in range(5):
            producer_fired = await engine.evaluate(
                make_event(event_module="k8s_audit", audit_verb="get", user_name=user)
            )
        assert len(producer_fired) == 1

        fired = await engine.evaluate(
            make_event(event_module="k8s_audit", event_action="get secrets", user_name=user)
        )
        assert len(fired) == 1

    async def test_single_event_below_producer_threshold_does_not_satisfy(self, redis_client, make_event):
        """원래(2026-07-19) S62가 부딪혔던 문제의 회귀 테스트 - 정적 1건 매칭이
        아니라 진짜 threshold(5회) 누적이 요구조건이므로, 1건만으로는 절대
        충족되지 않는다."""
        engine = await _engine(redis_client, _SAME_AXIS_PRODUCER, _SAME_AXIS_CONSUMER)
        user = "attacker@example.com"
        await engine.evaluate(make_event(event_module="k8s_audit", audit_verb="get", user_name=user))

        fired = await engine.evaluate(
            make_event(event_module="k8s_audit", event_action="get secrets", user_name=user)
        )
        assert fired == []


# S85(sequence, join_on=user_or_sa, fired_marker_join_on=pod)->S94(join_on=pod)
# 패턴 - sequence가 마지막 stage까지 완주해 발화하는 순간에도 마커를 남겨야 한다.
_SEQUENCE_PRODUCER = {
    "id": "TEST-WEB-TO-RISKY-POD",
    "db_id": "test-web-to-risky-pod-db-id",
    "name": "합성 웹 침투 체인 테스트 시나리오",
    "type": "sequence",
    "join_on": "user_or_sa",
    "correlation_key_type": "user.name",
    "required_modules": ["was", "k8s_audit"],
    "window_seconds": 300,
    "stamps_fired_marker": True,
    "fired_marker_join_on": "pod",
    "stage1": {"event_module": "was", "http_response_status_code": 401},
    "stage2": {
        "event_module": "k8s_audit",
        "audit_verb": "create",
        "orchestrator_resource_type": "pods",
    },
}

_SEQUENCE_CONSUMER = {
    "id": "TEST-ABNORMAL-PROCESS",
    "db_id": "test-abnormal-process-db-id",
    "name": "합성 신규 Pod 이상행동 테스트 시나리오",
    "type": "threshold",
    "join_on": "pod",
    "correlation_key_type": "orchestrator.resource.name",
    "required_modules": ["falco"],
    "window_seconds": 300,
    "threshold": 1,
    "cooldown_seconds": 600,
    "match": {
        "event_module": "falco",
        "event_action": "Terminal shell in container",
        "requires_recent_fire": "TEST-WEB-TO-RISKY-POD",
    },
    "severity": 4,
    "mitre_technique_id": "T1609",
}


class TestSequenceProducerStampsOnChainCompletion:
    async def test_fires_after_sequence_completes_on_the_pod_it_created(self, redis_client, make_event):
        engine = await _engine(redis_client, _SEQUENCE_PRODUCER, _SEQUENCE_CONSUMER)
        user = "compromised-user"
        pod = "juice-shop-xyz"

        stage1_fired = await engine.evaluate(
            make_event(event_module="was", http_response_status_code=401, actor_identity=user)
        )
        assert stage1_fired == []

        stage2_fired = await engine.evaluate(
            make_event(
                event_module="k8s_audit",
                audit_verb="create",
                orchestrator_resource_type="pods",
                user_name=user,
                orchestrator_resource_name=pod,
            )
        )
        assert len(stage2_fired) == 1

        fired = await engine.evaluate(
            make_event(
                event_module="falco",
                event_action="Terminal shell in container",
                orchestrator_resource_name=pod,
            )
        )
        assert len(fired) == 1

    async def test_does_not_fire_when_sequence_never_completed(self, redis_client, make_event):
        engine = await _engine(redis_client, _SEQUENCE_PRODUCER, _SEQUENCE_CONSUMER)
        pod = "juice-shop-xyz"
        # stage1만 보내고 stage2는 보내지 않음 - 체인 미완주
        await engine.evaluate(
            make_event(event_module="was", http_response_status_code=401, actor_identity="compromised-user")
        )

        fired = await engine.evaluate(
            make_event(
                event_module="falco",
                event_action="Terminal shell in container",
                orchestrator_resource_name=pod,
            )
        )
        assert fired == []
