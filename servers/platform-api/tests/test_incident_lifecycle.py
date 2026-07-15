"""인시던트 상세/이벤트목록/타임라인/상태전이/verdict - correlation-engine이 실제로
발화한 인시던트를 건드리지 않도록 synthetic_incident 픽스처(conftest.py)가 만든
전용 인시던트로만 검증한다. 픽스처가 function-scope라 테스트마다 독립된 인시던트를
새로 받으므로 테스트 간 순서 의존성이 없다."""


async def test_get_incident_detail(client, auth_headers, synthetic_incident):
    resp = await client.get(f"/incidents/{synthetic_incident}", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == synthetic_incident
    assert body["status"] == "open"
    assert body["verdict"] is None


async def test_get_incident_events(client, auth_headers, synthetic_incident):
    resp = await client.get(f"/incidents/{synthetic_incident}/events", headers=auth_headers)
    assert resp.status_code == 200
    events = resp.json()
    assert len(events) == 1
    assert events[0]["event_module"] == "waf"


async def test_get_incident_timeline_gracefully_handles_missing_opensearch_doc(
    client, auth_headers, synthetic_incident
):
    # synthetic_incident의 event_id("smoketest-event-1")는 OpenSearch에 실제
    # 원문이 없다 - title/detail 없이도 500 없이 graceful degrade해야 한다
    # (incidents_api.py get_incident_timeline의 문서화된 동작).
    resp = await client.get(f"/incidents/{synthetic_incident}/timeline", headers=auth_headers)
    assert resp.status_code == 200
    entries = resp.json()
    assert len(entries) == 1
    assert entries[0]["title"] == "(원본 로그 없음)"
    assert entries[0]["mitre_technique_id"] is None  # matched_scenario_rule_id가 NULL이라서


async def test_status_transition_open_to_investigating_succeeds(
    client, auth_headers, synthetic_incident
):
    resp = await client.patch(
        f"/incidents/{synthetic_incident}/status",
        json={"status": "investigating"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "investigating"


async def test_status_transition_backwards_is_rejected(client, auth_headers, synthetic_incident):
    await client.patch(
        f"/incidents/{synthetic_incident}/status",
        json={"status": "investigating"},
        headers=auth_headers,
    )
    resp = await client.patch(
        f"/incidents/{synthetic_incident}/status", json={"status": "open"}, headers=auth_headers
    )
    assert resp.status_code == 400


async def test_status_transition_skipping_investigating_is_rejected(
    client, auth_headers, synthetic_incident
):
    resp = await client.patch(
        f"/incidents/{synthetic_incident}/status", json={"status": "closed"}, headers=auth_headers
    )
    assert resp.status_code == 400


async def test_verdict_can_be_set_regardless_of_status(client, auth_headers, synthetic_incident):
    resp = await client.patch(
        f"/incidents/{synthetic_incident}/verdict",
        json={"verdict": "true_positive", "note": "smoke test"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["verdict"] == "true_positive"
    assert body["verdict_note"] == "smoke test"
    assert body["status"] == "open"  # verdict 설정이 status를 안 건드려야 함


async def test_verdict_rejects_invalid_value(client, auth_headers, synthetic_incident):
    resp = await client.patch(
        f"/incidents/{synthetic_incident}/verdict", json={"verdict": "maybe"}, headers=auth_headers
    )
    assert resp.status_code == 400


async def test_status_update_on_missing_incident_returns_404(client, auth_headers):
    resp = await client.patch(
        "/incidents/00000000-0000-0000-0000-000000000000/status",
        json={"status": "investigating"},
        headers=auth_headers,
    )
    assert resp.status_code == 404
