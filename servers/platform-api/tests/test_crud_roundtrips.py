"""부작용이 이 테스트가 만든 데이터 안에서만 끝나는 안전한 CRUD 엔드포인트만
왕복 검증한다. scenarios(/enabled 토글)·poll-intervals·log-policies는 값을
바꾸면 이미 살아서 실시간 트래픽을 처리 중인 correlation-engine/normalizer/
platform-api 자체(다른 컨테이너)의 동작에 실제로 영향을 주므로(탐지 억제, 보존
정책 변경 등) 이 dev 스택 대상으로는 일부러 쓰기 테스트를 하지 않는다 - 읽기(GET)만
test_read_endpoints.py에서 검증한다.

IP가 필요한 곳은 전부 TEST-NET-1(RFC 5737, 192.0.2.0/24) - 실제 트래픽에 쓰일 일이
없는 문서화 전용 대역이라 allow-list/banned-ips에 등록돼도 안전하다."""
import uuid


async def test_target_crud_roundtrip(client, auth_headers):
    name = f"_smoketest-target-{uuid.uuid4().hex[:8]}"
    create = await client.post(
        "/targets",
        json={"name": name, "base_url": "http://smoketest.invalid", "is_active": True},
        headers=auth_headers,
    )
    assert create.status_code == 200, create.text
    target_id = create.json()["id"]

    patch = await client.patch(
        f"/targets/{target_id}",
        json={"name": name, "base_url": "http://smoketest.invalid", "is_active": False},
        headers=auth_headers,
    )
    assert patch.status_code == 200
    assert patch.json()["is_active"] is False

    delete = await client.delete(f"/targets/{target_id}", headers=auth_headers)
    assert delete.status_code == 200


async def test_banned_ip_crud_roundtrip(client, auth_headers):
    ban = await client.post(
        "/banned-ips",
        json={"ip_or_cidr": "192.0.2.123/32", "reason": "smoketest"},
        headers=auth_headers,
    )
    assert ban.status_code == 200, ban.text
    banned_id = ban.json()["id"]

    listing = await client.get("/banned-ips", headers=auth_headers)
    assert any(item["id"] == banned_id for item in listing.json())

    unban = await client.delete(f"/banned-ips/{banned_id}", headers=auth_headers)
    assert unban.status_code == 200
    assert unban.json()["unbanned_at"] is not None


async def test_banned_ip_rejects_invalid_cidr(client, auth_headers):
    resp = await client.post(
        "/banned-ips", json={"ip_or_cidr": "999.999.999.999"}, headers=auth_headers
    )
    assert resp.status_code == 400


async def test_alert_config_crud_roundtrip(client, auth_headers):
    create = await client.post(
        "/alert-configs",
        json={
            "channel_type": "slack",
            "webhook_url": "https://example.com/smoketest-webhook",
            "enabled": False,
            "min_severity": 4,
        },
        headers=auth_headers,
    )
    assert create.status_code == 200, create.text
    config_id = create.json()["id"]

    patch = await client.patch(
        f"/alert-configs/{config_id}",
        json={
            "channel_type": "slack",
            "webhook_url": "https://example.com/smoketest-webhook",
            "enabled": True,
            "min_severity": 3,
        },
        headers=auth_headers,
    )
    assert patch.status_code == 200
    assert patch.json()["min_severity"] == 3

    delete = await client.delete(f"/alert-configs/{config_id}", headers=auth_headers)
    assert delete.status_code == 200


async def test_alert_config_rejects_unknown_channel_type(client, auth_headers):
    resp = await client.post(
        "/alert-configs",
        json={"channel_type": "slcak", "webhook_url": "https://example.com/x"},
        headers=auth_headers,
    )
    assert resp.status_code == 400


async def test_allow_list_crud_roundtrip(client, auth_headers):
    create = await client.post(
        "/allow-list",
        json={"ip_or_cidr": "192.0.2.124/32", "reason": "smoketest"},
        headers=auth_headers,
    )
    assert create.status_code == 200, create.text
    entry_id = create.json()["id"]

    delete = await client.delete(f"/allow-list/{entry_id}", headers=auth_headers)
    assert delete.status_code == 200


async def test_allow_list_rejects_invalid_cidr(client, auth_headers):
    resp = await client.post("/allow-list", json={"ip_or_cidr": "not-an-ip"}, headers=auth_headers)
    assert resp.status_code == 400


async def test_user_crud_roundtrip(client, auth_headers):
    username = f"_smoketest-user-{uuid.uuid4().hex[:8]}"
    create = await client.post(
        "/users",
        json={"username": username, "password": "roundtrip-pw-1", "role": "viewer"},
        headers=auth_headers,
    )
    assert create.status_code == 200, create.text
    user_id = create.json()["id"]

    patch = await client.patch(f"/users/{user_id}", json={"role": "admin"}, headers=auth_headers)
    assert patch.status_code == 200
    assert patch.json()["role"] == "admin"

    delete = await client.delete(f"/users/{user_id}", headers=auth_headers)
    assert delete.status_code == 200


async def test_user_creation_rejects_short_password(client, auth_headers):
    resp = await client.post(
        "/users",
        json={"username": "should-not-be-created", "password": "short", "role": "viewer"},
        headers=auth_headers,
    )
    assert resp.status_code == 400


async def test_user_creation_rejects_duplicate_username(client, auth_headers, test_admin):
    resp = await client.post(
        "/users",
        json={"username": test_admin, "password": "irrelevant1", "role": "viewer"},
        headers=auth_headers,
    )
    assert resp.status_code == 409
