"""correlation-engine 테스트 공용 픽스처.

실행 방법:
    cd servers/correlation-engine
    pip install -r requirements-dev.txt
    pytest

실제 Kafka/Postgres 없이 fakeredis만으로 ScenarioEngine의 순수 로직(입력:
NormalizedEvent + 시나리오 dict, 출력: 발화 여부)을 검증한다. 시나리오 정의는
app/scenarios/*.yaml을 app.main._load_scenarios()로 그대로 읽어 쓰므로(하드코딩된
사본을 따로 안 둠) YAML을 고치면 테스트도 그 변경을 즉시 반영해서 평가한다 -
프로덕션이 실제로 로드하는 것과 다른 걸 테스트하는 괴리를 원천 차단한다.
"""
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Dict

import fakeredis.aioredis
import pytest

from app.main import _load_scenarios
from app.rules import ScenarioEngine
from ids_shared.schemas import NormalizedEvent


@pytest.fixture(scope="session")
def all_scenarios():
    """app/scenarios/*.yaml 전체 - 실제 프로덕션 정의 그대로(세션당 한 번만 로드)."""
    return _load_scenarios()


@pytest.fixture
def scenario_by_id(all_scenarios):
    def _get(scenario_id: str) -> Dict[str, Any]:
        for s in all_scenarios:
            if s["id"] == scenario_id:
                return s
        raise KeyError(f"시나리오 없음: {scenario_id} (app/scenarios/*.yaml 확인)")

    return _get


@pytest.fixture
async def redis_client():
    """테스트마다 완전히 비어있는 fakeredis 인스턴스 - 이전 테스트의 카운터/쿨다운
    키가 남아 순서 의존성이 생기는 걸 막는다(fixture scope=function 기본값)."""
    client = fakeredis.aioredis.FakeRedis(decode_responses=True)
    try:
        yield client
    finally:
        close = getattr(client, "aclose", None) or client.close
        await close()


@pytest.fixture
def engine(all_scenarios, redis_client):
    return ScenarioEngine(all_scenarios, redis_client)


@pytest.fixture
def make_event() -> Callable[..., NormalizedEvent]:
    """NormalizedEvent를 필수 필드는 기본값으로 채우고 나머지는 override로 받는
    팩토리. 필드명은 언더스코어 표기(pydantic 내부 이름)로 넘긴다 - rules.py의
    getattr(event, event_attr)가 보는 이름과 동일하다(populate_by_name=True라
    둘 다 되지만 테스트도 프로덕션 코드가 실제로 읽는 이름으로 통일)."""

    def _make(**overrides: Any) -> NormalizedEvent:
        event_module = overrides.get("event_module", "k8s_audit")
        now = datetime.now(timezone.utc)
        defaults: Dict[str, Any] = {
            "timestamp": now,
            "event_ingested": now,
            "event_id": str(uuid.uuid4()),
            "event_module": event_module,
            "event_dataset": f"{event_module}.test",
            "event_original": "{}",
        }
        defaults.update(overrides)
        return NormalizedEvent(**defaults)

    return _make
