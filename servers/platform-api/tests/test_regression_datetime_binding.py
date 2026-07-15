"""오늘 실제로 고친 세 가지 500/422 버그의 회귀 테스트 - 전부 "쿼리스트링의
ISO8601 문자열/서브아워 hours를 드라이버에 그대로 못 넘겨서 죽는" 계열이라
한곳에 모아둔다.

1. GET /stats/kpi·/stats/volume·/stats/levels의 hours가 한때 int라 1시간 미만
   프리셋(예: 대시보드의 "최근 1분")에서 422(Input should be a valid integer)가
   났다 - app/stats_api.py가 hours: float로 바뀐 지금은 전부 200이어야 한다.
2. GET /stats/geo·/stats/top-ips·/stats/k8s-targets 등 ClickHouse 집계
   엔드포인트에 start/end를 문자열 그대로 바인딩하면 Code 53 TYPE_MISMATCH로
   500이 났다 - app/timeparse.py의 parse_iso8601로 datetime 객체를 바인딩하는
   지금은 200이어야 한다.
3. GET /incidents?since=...도 asyncpg가 문자열 바인딩 자체를 거부해서 500이
   났다 - 같은 timeparse.py 경유로 지금은 200이어야 한다.
"""
import pytest

_SUB_HOUR_PRESETS = [1 / 60, 5 / 60, 15 / 60, 0.5]  # 1분/5분/15분/30분


@pytest.mark.parametrize("hours", _SUB_HOUR_PRESETS)
async def test_kpi_accepts_sub_hour_float_hours(client, auth_headers, hours):
    resp = await client.get(f"/stats/kpi?hours={hours}", headers=auth_headers)
    assert resp.status_code == 200, resp.text


@pytest.mark.parametrize("hours", _SUB_HOUR_PRESETS)
async def test_volume_accepts_sub_hour_float_hours(client, auth_headers, hours):
    resp = await client.get(f"/stats/volume?hours={hours}", headers=auth_headers)
    assert resp.status_code == 200, resp.text


@pytest.mark.parametrize("hours", _SUB_HOUR_PRESETS)
async def test_levels_accepts_sub_hour_float_hours(client, auth_headers, hours):
    resp = await client.get(f"/stats/levels?hours={hours}", headers=auth_headers)
    assert resp.status_code == 200, resp.text


async def test_kpi_rejects_non_numeric_hours_with_422(client, auth_headers):
    # float로 바뀌었어도 숫자가 아닌 값은 여전히 422가 맞다 - 이 테스트는 "hours가
    # 뭐든 다 받아준다"가 아니라 "숫자면 정수든 소수든 다 받는다"는 것만 검증한다.
    resp = await client.get("/stats/kpi?hours=not-a-number", headers=auth_headers)
    assert resp.status_code == 422


_ISO_START = "2020-01-01T00:00:00.000Z"
_ISO_END = "2030-01-01T00:00:00.000Z"


async def test_clickhouse_geo_accepts_iso8601_start_end(client, auth_headers):
    resp = await client.get(f"/stats/geo?start={_ISO_START}&end={_ISO_END}", headers=auth_headers)
    assert resp.status_code == 200, resp.text


async def test_clickhouse_top_ips_accepts_iso8601_start_end(client, auth_headers):
    resp = await client.get(
        f"/stats/top-ips?start={_ISO_START}&end={_ISO_END}", headers=auth_headers
    )
    assert resp.status_code == 200, resp.text
    assert "items" in resp.json()


async def test_clickhouse_k8s_targets_accepts_iso8601_start_end(client, auth_headers):
    resp = await client.get(
        f"/stats/k8s-targets?start={_ISO_START}&end={_ISO_END}", headers=auth_headers
    )
    assert resp.status_code == 200, resp.text


async def test_incidents_since_accepts_iso8601_and_does_not_500(client, auth_headers):
    resp = await client.get(f"/incidents?since={_ISO_START}", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    # since 폴링은 오래된순으로 나와야 한다(실시간 팝업이 "마지막 확인 시각 이후
    # 오래된 것부터" 순서로 소비하기 때문 - incidents_api.py list_incidents 참고).
    created_ats = [item["created_at"] for item in resp.json()]
    assert created_ats == sorted(created_ats)


async def test_audit_logs_cursor_accepts_encoded_iso8601(client, auth_headers):
    # audit_logs_api.py도 같은 parse_iso8601 경유 - cursor 페이지네이션 왕복 확인.
    first = await client.get("/audit-logs?limit=1", headers=auth_headers)
    assert first.status_code == 200
    cursor = first.headers.get("x-next-cursor")
    if cursor:
        second = await client.get(f"/audit-logs?limit=1&cursor={cursor}", headers=auth_headers)
        assert second.status_code == 200, second.text
