"""로그인/세션/verify/로그아웃 흐름. 여기서 쓰는 관리자 계정은 실제 dev DB의
admin이 아니라 conftest.py가 세션 시작 시 만드는 테스트 전용 계정이다."""
from tests.conftest import TEST_ADMIN_PASSWORD, TEST_ADMIN_USERNAME


async def test_login_with_correct_password_returns_token(client, test_admin):
    resp = await client.post(
        "/auth/login", json={"username": TEST_ADMIN_USERNAME, "password": TEST_ADMIN_PASSWORD}
    )
    assert resp.status_code == 200
    assert resp.json()["token"]


async def test_login_with_wrong_password_is_rejected(client, test_admin):
    resp = await client.post(
        "/auth/login", json={"username": TEST_ADMIN_USERNAME, "password": "wrong-password"}
    )
    assert resp.status_code == 401


async def test_login_with_unknown_username_is_rejected(client):
    resp = await client.post("/auth/login", json={"username": "no-such-user", "password": "x"})
    assert resp.status_code == 401


async def test_session_valid_with_token(client, auth_headers):
    resp = await client.get("/auth/session", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["valid"] is True
    assert body["username"] == TEST_ADMIN_USERNAME
    assert body["role"] == "admin"


async def test_session_invalid_without_token(client):
    resp = await client.get("/auth/session")
    assert resp.status_code == 200
    assert resp.json()["valid"] is False


async def test_verify_passes_get_with_valid_token(client, auth_headers):
    # Traefik forwardAuth가 실제로 호출하는 엔드포인트 - GET/HEAD는 로그인만
    # 되어 있으면 통과한다(app/auth.py의 GET /verify).
    resp = await client.get("/auth/verify", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.headers["x-auth-role"] == "admin"
    assert resp.headers["x-auth-username"] == TEST_ADMIN_USERNAME


async def test_verify_rejects_missing_token(client):
    resp = await client.get("/auth/verify")
    assert resp.status_code == 401


async def test_verify_treats_forwarded_options_as_cors_preflight(client):
    # Traefik forwardAuth는 항상 GET으로 /auth/verify를 호출하고, 원래 요청의
    # 메서드는 X-Forwarded-Method 헤더로 실어 보낸다(auth.py verify() 참고 - "OPTIONS"
    # 자체를 이 경로에 직접 보내는 게 아니다). 브라우저 프리플라이트(OPTIONS)는
    # Authorization 헤더를 안 실어 보내므로 토큰 없이도 통과해야 한다 - 아니면
    # 실제 요청이 나가기도 전에 프리플라이트가 401로 막힌다.
    resp = await client.get("/auth/verify", headers={"X-Forwarded-Method": "OPTIONS"})
    assert resp.status_code == 200
    assert resp.json()["valid"] is True


async def test_logout_revokes_token(client, test_admin):
    login_resp = await client.post(
        "/auth/login", json={"username": TEST_ADMIN_USERNAME, "password": TEST_ADMIN_PASSWORD}
    )
    headers = {"Authorization": f"Bearer {login_resp.json()['token']}"}

    logout_resp = await client.post("/auth/logout", headers=headers)
    assert logout_resp.status_code == 200

    session_resp = await client.get("/auth/session", headers=headers)
    assert session_resp.json()["valid"] is False
