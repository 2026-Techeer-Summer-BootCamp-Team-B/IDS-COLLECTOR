"""인시던트 상세/이벤트목록/타임라인/상태전이/verdict - correlation-engine이 실제로
발화한 인시던트를 건드리지 않도록 synthetic_incident 픽스처(conftest.py)가 만든
전용 인시던트로만 검증한다. 픽스처가 function-scope라 테스트마다 독립된 인시던트를
새로 받으므로 테스트 간 순서 의존성이 없다."""
import asyncio


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


async def test_concurrent_status_transition_only_succeeds_once(
    client, auth_headers, synthetic_incident
):
    responses = await asyncio.gather(
        client.patch(
            f"/incidents/{synthetic_incident}/status",
            json={"status": "investigating"},
            headers=auth_headers,
        ),
        client.patch(
            f"/incidents/{synthetic_incident}/status",
            json={"status": "investigating"},
            headers=auth_headers,
        ),
    )

    assert sorted(response.status_code for response in responses) == [200, 400]


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

async def test_incident_summary_and_changes_include_verdict_updates(client, auth_headers, synthetic_incident):
    summary = await client.get("/incidents/summary", headers=auth_headers)
    assert summary.status_code == 200
    assert summary.json()["total"] >= 1
    assert "open" in summary.json()["by_status"]

    snapshot = await client.get("/incidents?limit=1", headers=auth_headers)
    before = snapshot.headers["X-Next-Since"]
    verdict = await client.patch(
        f"/incidents/{synthetic_incident}/verdict",
        json={"verdict": "true_positive", "note": "delta test"},
        headers=auth_headers,
    )
    assert verdict.status_code == 200
    changes = await client.get(
        "/incidents/changes",
        params={"since": before},
        headers=auth_headers,
    )
    assert changes.status_code == 200
    assert any(item["id"] == synthetic_incident and item["verdict"] == "true_positive" for item in changes.json())
    assert changes.headers.get("X-Next-Since")


async def test_initial_incident_snapshot_supplies_server_watermark(
    client, auth_headers, synthetic_incident
):
    snapshot = await client.get("/incidents?status=open&limit=500", headers=auth_headers)
    assert snapshot.status_code == 200
    watermark = snapshot.headers.get("X-Next-Since")
    assert watermark

    updated = await client.patch(
        f"/incidents/{synthetic_incident}/status",
        json={"status": "investigating"},
        headers=auth_headers,
    )
    assert updated.status_code == 200

    changes = await client.get(
        "/incidents/changes",
        params={"since": watermark},
        headers=auth_headers,
    )
    assert changes.status_code == 200
    assert any(item["id"] == synthetic_incident for item in changes.json())


async def test_watermark_does_not_pass_an_uncommitted_incident_change(
    client, auth_headers, synthetic_incident, pg_pool
):
    async with pg_pool.acquire() as writer:
        transaction = writer.transaction()
        await transaction.start()
        committed = False
        try:
            transaction_started_at = await writer.fetchval("SELECT now()")
            await writer.execute(
                """
                UPDATE incidents
                SET verdict_note = 'late commit', updated_at = now()
                WHERE id = $1
                """,
                synthetic_incident,
            )

            snapshot = await client.get("/incidents?limit=1", headers=auth_headers)
            assert snapshot.status_code == 200
            watermark = snapshot.headers["X-Next-Since"]
            assert watermark < transaction_started_at.isoformat()

            await transaction.commit()
            committed = True
        except Exception:
            if not committed:
                await transaction.rollback()
            raise

    changes = await client.get(
        "/incidents/changes",
        params={"since": watermark},
        headers=auth_headers,
    )
    assert changes.status_code == 200
    assert any(item["id"] == synthetic_incident for item in changes.json())


async def test_change_written_after_snapshot_uses_write_time(
    client, auth_headers, synthetic_incident, pg_pool
):
    async with pg_pool.acquire() as writer:
        transaction = writer.transaction()
        await transaction.start()
        committed = False
        try:
            # 트랜잭션은 먼저 열되 아직 XID를 받는 쓰기는 하지 않는다.
            await writer.fetchval("SELECT 1")
            snapshot = await client.get("/incidents?limit=1", headers=auth_headers)
            assert snapshot.status_code == 200
            watermark = snapshot.headers["X-Next-Since"]

            # snapshot 뒤 실제 write 시각을 기록해야 위 watermark 다음 poll에
            # 반드시 포함된다. transaction start 시각(now())을 쓰면 누락된다.
            await writer.execute(
                """
                UPDATE incidents
                SET verdict_note = 'post snapshot write',
                    updated_at = clock_timestamp()
                WHERE id = $1
                """,
                synthetic_incident,
            )
            await transaction.commit()
            committed = True
        except Exception:
            if not committed:
                await transaction.rollback()
            raise

    changes = await client.get(
        "/incidents/changes",
        params={"since": watermark},
        headers=auth_headers,
    )
    assert changes.status_code == 200
    assert any(item["id"] == synthetic_incident for item in changes.json())


async def test_cors_exposes_incident_watermark(client, auth_headers):
    response = await client.get(
        "/incidents?limit=1",
        headers={**auth_headers, "Origin": "http://dashboard.example"},
    )
    exposed = response.headers.get("Access-Control-Expose-Headers", "").lower()
    assert "x-next-cursor" in exposed
    assert "x-next-since" in exposed


async def test_legacy_incident_since_remains_creation_based(client, auth_headers, synthetic_incident):
    baseline = "2100-01-01T00:00:00+00:00"
    response = await client.get(
        "/incidents",
        params={"since": baseline},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json() == []
