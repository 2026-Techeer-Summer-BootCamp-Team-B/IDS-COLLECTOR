"""문서화된 GET 엔드포인트가 전부 200을 내는지 확인하는 스모크 테스트 - 오늘
고친 hours:int→float 422 버그, ClickHouse/asyncpg datetime 바인딩 버그의 회귀
테스트는 test_regression_datetime_binding.py에 더 좁게 따로 있다. 여기는 순수
읽기 전용이라 이 dev 스택에 부작용이 전혀 없다."""
import pytest

_GET_ENDPOINTS = [
    "/incidents",
    "/incidents?limit=5",
    "/logs",
    "/logs?limit=5",
    "/stats",
    "/stats/source-health",
    "/stats/kpi",
    "/stats/volume",
    "/stats/levels",
    "/stats/timeseries?range=24h",
    "/stats/geo",
    "/stats/k8s-targets",
    "/stats/top-ips",
    "/stats/consumer-lag",
    "/stats/dlq-depth",
    "/stats/unknown-depth",
    "/stats/dlq-peek",
    "/stats/clock-skew",
    "/scenarios",
    "/alert-configs",
    "/audit-logs",
    "/audit-logs?limit=5",
    "/attck/coverage",
    "/banned-ips",
    "/targets",
    "/users",
    "/allow-list",
    "/events/recent",
    "/events/recent?limit=5",
    "/log-policies",
    "/poll-intervals",
    "/reports/trend",
    "/reports/trend?days=3",
]


@pytest.mark.parametrize("path", _GET_ENDPOINTS)
async def test_get_endpoint_returns_200(client, auth_headers, path):
    resp = await client.get(path, headers=auth_headers)
    assert resp.status_code == 200, f"{path} -> {resp.status_code}: {resp.text}"


async def test_attck_technique_incidents_for_known_technique(client, auth_headers):
    # T1610은 S15(시스템 네임스페이스 pod 생성)가 실제로 쓰는 값
    # (correlation-engine/app/scenarios/workload.yaml) - 카탈로그에 있는 기법이라
    # 매칭된 인시던트가 0건이어도 200이어야 한다.
    resp = await client.get("/attck/coverage/T1610/incidents", headers=auth_headers)
    assert resp.status_code == 200


async def test_attck_technique_incidents_for_unknown_technique_returns_empty_not_error(
    client, auth_headers
):
    resp = await client.get("/attck/coverage/T9999/incidents", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == []


async def test_incident_not_found_returns_404(client, auth_headers):
    resp = await client.get(
        "/incidents/00000000-0000-0000-0000-000000000000", headers=auth_headers
    )
    assert resp.status_code == 404
