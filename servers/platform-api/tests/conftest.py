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
import os
import uuid
from typing import AsyncIterator, Dict

import pytest


def pytest_collection_modifyitems(items: list) -> None:
    """모든 테스트를 session 스코프 루프에서 돌게 한다(2026-07-18 재작성).

    pytest.ini의 asyncio_default_fixture_loop_scope=session은 async "픽스처"에만
    적용되고 테스트 함수 자체에는 적용되지 않는다(pytest-asyncio==0.24.0 - 마커 없는
    테스트는 항상 loop_scope="function"으로 고정, plugin.py의 _get_marked_loop_scope
    참고 - "Unknown config option"이라 이 버전엔 테스트 쪽 기본 스코프를 ini로 바꾸는
    옵션 자체가 없다). 그 결과 session 스코프 픽스처(datastore_clients가 여는 asyncpg
    pool 등)는 pytest-asyncio 내부 세션 루프에서 만들어지는데, 마커 없는 각 테스트는
    자기만의 function 스코프 루프에서 돌아서 서로 다른 루프가 됐다 - asyncpg/
    opensearch-py가 커넥션의 Future를 "다른 loop에 붙었다"고 보는
    RuntimeError/InterfaceError로 실측 확인(2026-07-18).

    예전엔 `event_loop` 픽스처 자체를 session 스코프로 오버라이드해서 고치려 했지만,
    pytest-asyncio 0.24는 session 스코프 픽스처를 위해 별도의 내부 세션 루프
    (_session_event_loop)를 따로 쓰고 `event_loop`이라는 이름의 픽스처는 여전히
    "마커 없는(=function 스코프) 테스트"쪽에만 연결된다 - 즉 오버라이드해도 두 루프가
    여전히 갈라져서 근본 해결이 안 됐다(deprecated 경고까지 뜸). 대신 모든 테스트
    아이템에 @pytest.mark.asyncio(loop_scope="session") 마커를 강제로 붙여서, 테스트도
    픽스처와 똑같은 내부 세션 루프를 쓰게 만드는 게 이 버전에서 지원하는 유일한
    방법이다.

    asyncio_mode=auto가 각 테스트에 미리 붙여둔 스코프 없는(=function) "asyncio"
    마커가 이미 있어서 item.add_marker()로 그냥 추가만 하면 get_closest_marker()가
    먼저 붙은(=auto가 붙인) 마커를 반환해 무시된다(own_markers는 추가된 순서 그대로
    yield됨, 실측 확인) - 기존 마커를 먼저 지우고 session 스코프로 다시 붙인다."""
    for item in items:
        item.own_markers = [m for m in item.own_markers if m.name != "asyncio"]
        item.add_marker(pytest.mark.asyncio(loop_scope="session"))

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
os.environ.setdefault(
    "REPORT_TOKEN_ENCRYPTION_KEY",
    "8yWaRahCNcYY6l5EmPqJtXtbaIdbpTkOGAZOFWU55Cw=",
)
# 게이트웨이 시크릿 강제(감사 S13, 2026-07-16, app/main.py의 GatewaySecretMiddleware) -
# 이 테스트는 Traefik을 거치지 않고 app.main:app을 직접 ASGI로 구동하므로(모듈
# docstring 참고) Traefik이 실제 요청에 주입해주는 X-Internal-Gateway-Secret 헤더가
# 없다. 아래 client 픽스처가 이 값을 그대로 헤더에 실어 보내서 프로덕션의 Traefik
# 미들웨어 주입을 흉내낸다.
os.environ.setdefault("INTERNAL_GATEWAY_SECRET", "_smoketest-gateway-secret")

import httpx  # noqa: E402  (env 세팅 이후 import 필수)

from app import clickhouse_client, db, opensearch_client, pipeline_health_api  # noqa: E402
from app.main import app  # noqa: E402

TEST_ADMIN_USERNAME = "_smoketest_admin"
TEST_ADMIN_PASSWORD = "smoketest-admin-pw-1"


@pytest.fixture(scope="session", autouse=True)
async def datastore_clients() -> AsyncIterator[None]:
    """라우트 핸들러가 쓰는 db/clickhouse/opensearch/pipeline_health(Kafka) 클라이언트만
    기동한다 - 모듈 docstring 참고(백그라운드 폴링 태스크는 일부러 안 띄움).
    pipeline_health_api는 2026-07-18 API latency 개선으로 요청마다 새 Kafka
    클라이언트를 만들던 걸 앱 기동 시 한 번만 만들어 재사용하는 방식으로 바뀌어서,
    이 fixture도 db/clickhouse/opensearch와 동일하게 명시적으로 start() 해줘야
    /stats/consumer-lag 등 4개 엔드포인트가 동작한다."""
    await db.start()
    await clickhouse_client.start()
    await opensearch_client.start()
    await pipeline_health_api.start()
    yield
    await pipeline_health_api.stop()
    await clickhouse_client.stop()
    await db.stop()


@pytest.fixture
async def client(datastore_clients) -> AsyncIterator[httpx.AsyncClient]:
    # timeout을 넉넉히 준다 - /stats/consumer-lag 등은 매 호출마다 새
    # AIOKafkaConsumer/AdminClient로 브로커에 붙어서(app/pipeline_health_api.py)
    # httpx 기본 5초보다 오래 걸릴 수 있다.
    transport = httpx.ASGITransport(app=app)
    headers = {"x-internal-gateway-secret": os.environ["INTERNAL_GATEWAY_SECRET"]}
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver", timeout=30.0, headers=headers
    ) as c:
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
