"""platform-api 스모크 테스트 공용 픽스처.

실행 방법:
    docker ps로 postgres/opensearch/clickhouse/redis/kafka가 떠 있는지 확인한 뒤
    (저장소 루트에서 `make up`, 또는 이미 떠 있는 dev 스택을 그대로 사용)
    cd servers/platform-api
    pip install -r requirements-dev.txt
    pytest

이 테스트는 실제 Postgres/OpenSearch/ClickHouse/Redis/Kafka에 연결한다(fakeredis/
모킹 없음) - normalizer/correlation-engine 단위 테스트와 다르게 "라우트 핸들러가
실제 드라이버로 실제 쿼리를 날렸을 때 타입 바인딩이 맞는지" 자체가 검증 대상이라
모킹하면 의미가 없다.

컨테이너 내부 네트워크(siem-net) 호스트명(postgres/opensearch/clickhouse/redis)이
아니라 dev 스택이 호스트에 발행한 포트(localhost:5432/9200/8123/6379/9094)로
붙는다 - platform-api 컨테이너 자체를 띄우지 않고 이 pytest 프로세스 안에서
app.main:app을 직접 ASGI로 구동하는 방식(httpx.ASGITransport)이라, 이미 떠 있는
platform-api 컨테이너 이미지가 최신 소스와 같은지 여부와 무관하게 항상 지금 이
소스 코드를 검증한다.

app.main의 FastAPI startup 이벤트는 일부러 그대로 실행하지 않는다 - 그 안에서
spawn되는 incident_alerts.poll_loop()/log_retention.poll_loop()가 각각 실제
Slack/Discord 웹훅 발송과 OpenSearch 문서 삭제를 수행해서, 이미 실제 트래픽이
쌓인 이 dev 스택에 부작용을 낸다(httpx.ASGITransport는 애초에 lifespan 이벤트를
안 보내므로 아무 조치를 안 해도 이 두 백그라운드 태스크는 안 뜬다 - db/clickhouse/
opensearch 클라이언트의 start()만 직접 호출해서 라우트 핸들러가 필요로 하는
연결만 준비한다). 그 결과 GET /health는 이 테스트 환경에서 503이 정상이다
(test_health.py 참고 - 실제 배포 환경의 503은 진짜 장애).

쓰기 테스트가 만드는 데이터는 전부 `_smoketest`/`smoketest` 접두사나 TEST-NET
(RFC 5737, 192.0.2.0/24) IP를 써서 실데이터와 구분되게 하고, 픽스처 teardown에서
전부 정리한다 - 다만 scenarios(/enabled 토글)·poll-intervals·log-policies는
값을 바꾸면 이미 살아서 실시간 트래픽을 처리 중인 correlation-engine/normalizer/
platform-api 자체(다른 컨테이너)의 동작에 실제로 영향을 주므로(탐지 억제, 보존
정책 변경 등) 이 dev 스택 대상으로는 읽기(GET)만 검증하고 쓰기는 하지 않는다."""
import asyncio
import os
import uuid
from typing import AsyncIterator, Dict

import pytest


@pytest.fixture(scope="session")
def event_loop():
    """세션 스코프 async 픽스처(db pool 등)와 개별 테스트가 같은 이벤트 루프를
    쓰게 강제한다 - pytest-asyncio 0.24는 asyncio_default_fixture_loop_scope로
    픽스처 쪽만 session으로 묶을 수 있고 테스트 함수 자체의 기본 루프 스코프를
    ini로 지정하는 옵션은 없어서(시도했더니 "Unknown config option"), 기본값인
    함수별 새 이벤트 루프에서 실행된 테스트가 세션 스코프로 미리 열어둔 asyncpg
    풀의 커넥션을 다른 루프에서 재사용하려다 `InterfaceError: cannot perform
    operation: another operation is in progress`로 깨졌다(실측 확인) - 이 커스텀
    event_loop 픽스처로 세션 전체가 정확히 하나의 루프를 공유하게 고정해서 해결."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()

# app.config.Settings()는 import 시점에 인스턴스화되므로, app 패키지의 어떤
# 모듈이든 처음 import되기 전에 환경변수를 심어야 한다 - conftest.py는 pytest가
# 테스트 모듈보다 먼저 로드하므로 여기가 유일하게 안전한 지점이다. 컨테이너 내부
# 호스트명(siem-net 전용) 대신 이 dev 스택이 호스트에 발행한 포트로 접속한다
# (servers/.env, servers/datastore/*/.env의 실제 dev 비밀번호 그대로 - docker ps로
# 이미 떠 있는 걸 확인한 컨테이너들과 동일한 값).
os.environ.setdefault("POSTGRES_DSN", "postgresql://ids_admin:devpassword123@localhost:5432/ids_platform")
os.environ.setdefault("REDIS_URL", "redis://:CHANGE_ME_dev@localhost:6379/0")
os.environ.setdefault("OPENSEARCH_URL", "http://localhost:9200")
os.environ.setdefault("CLICKHOUSE_HOST", "localhost")
os.environ.setdefault("CLICKHOUSE_PORT", "8123")
os.environ.setdefault("CLICKHOUSE_USER", "admin")
os.environ.setdefault("CLICKHOUSE_PASSWORD", "mypassword")
os.environ.setdefault("KAFKA_BROKERS", "localhost:9094")
os.environ.setdefault("GEMINI_API_KEY", "")  # /reports/trend가 외부 API 호출 없이 결정적으로 동작하게

import httpx  # noqa: E402  (env 세팅 이후 import 필수)

from app import clickhouse_client, db, opensearch_client  # noqa: E402
from app.main import app  # noqa: E402

TEST_ADMIN_USERNAME = "_smoketest_admin"
TEST_ADMIN_PASSWORD = "smoketest-admin-pw-1"


@pytest.fixture(scope="session", autouse=True)
async def datastore_clients() -> AsyncIterator[None]:
    """라우트 핸들러가 쓰는 db/clickhouse/opensearch 클라이언트만 기동한다 - 모듈
    docstring 참고(백그라운드 폴링 태스크는 일부러 안 띄움)."""
    await db.start()
    await clickhouse_client.start()
    await opensearch_client.start()
    yield
    await clickhouse_client.stop()
    await db.stop()


@pytest.fixture
async def client(datastore_clients) -> AsyncIterator[httpx.AsyncClient]:
    # timeout을 넉넉히 준다 - /stats/consumer-lag 등은 매 호출마다 새
    # AIOKafkaConsumer/AdminClient로 브로커에 붙어서(app/pipeline_health_api.py)
    # httpx 기본 5초보다 오래 걸릴 수 있다.
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=30.0) as c:
        yield c


@pytest.fixture(scope="session")
async def pg_pool(datastore_clients):
    """테스트 데이터(계정/인시던트)를 API를 거치지 않고 직접 심고 치우는 용도 -
    app/db.py가 관리하는 풀을 그대로 재사용한다(같은 DSN으로 별도 풀을 또 만들
    이유가 없음)."""
    return db.pool()


@pytest.fixture(scope="session")
async def test_admin(pg_pool) -> AsyncIterator[str]:
    """실제 dev DB의 admin 계정 비밀번호는 이 세션이 알 방법이 없다(배포 시점에
    ADMIN_INITIAL_PASSWORD로 시드되고 평문은 어디에도 안 남음, servers/datastore/
    postgres/init/005-seed-admin-user.sh 참고) - 그 계정을 빌리는 대신, 이
    테스트만 쓰는 전용 admin 계정을 직접 만들고 세션이 끝나면 지운다. CI 등
    매번 새로 뜨는 Postgres에서도 동일하게 동작한다."""
    async with pg_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO users (username, password_hash, role)
            VALUES ($1, crypt($2, gen_salt('bf')), 'admin')
            ON CONFLICT (username) DO UPDATE
            SET password_hash = crypt($2, gen_salt('bf')), role = 'admin'
            """,
            TEST_ADMIN_USERNAME,
            TEST_ADMIN_PASSWORD,
        )
    yield TEST_ADMIN_USERNAME
    async with pg_pool.acquire() as conn:
        await conn.execute("DELETE FROM users WHERE username = $1", TEST_ADMIN_USERNAME)


@pytest.fixture
async def admin_token(client, test_admin) -> str:
    resp = await client.post(
        "/auth/login", json={"username": TEST_ADMIN_USERNAME, "password": TEST_ADMIN_PASSWORD}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["token"]


@pytest.fixture
async def auth_headers(admin_token) -> Dict[str, str]:
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture
async def synthetic_incident(pg_pool) -> AsyncIterator[str]:
    """실제로 correlation-engine이 발화한 인시던트를 건드리지 않도록 이 테스트
    전용 인시던트를 직접 심고(matched_scenario_rule_id는 NULL - FK를 만족시키려고
    가짜 scenario_rules 행까지 만들 필요가 없게, incidents.matched_scenario_rule_id는
    nullable) 테스트가 끝나면 지운다. incident_events는 ON DELETE CASCADE라
    incidents 삭제만으로 같이 지워진다(001-schema.sql)."""
    incident_id = str(uuid.uuid4())
    async with pg_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO incidents (id, title, correlation_key_type, correlation_key_value, severity, status)
            VALUES ($1, 'smoketest synthetic incident', 'source.ip', '203.0.113.99', 2, 'open')
            """,
            incident_id,
        )
        await conn.execute(
            """
            INSERT INTO incident_events (incident_id, event_id, event_module)
            VALUES ($1, 'smoketest-event-1', 'waf')
            """,
            incident_id,
        )
    yield incident_id
    async with pg_pool.acquire() as conn:
        await conn.execute("DELETE FROM incidents WHERE id = $1", incident_id)
