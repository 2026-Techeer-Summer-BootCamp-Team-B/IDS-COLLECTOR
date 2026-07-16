"""GET /health - 이 앱의 /health는 폴링 백그라운드 태스크(incident_alerts/
log_retention) 생사만 보고 DB 연결 자체는 안 본다(app/main.py의 _dead_task_reason
참고)."""


async def test_health_reflects_that_background_pollers_are_not_started(client):
    """이 스모크 테스트 하네스는 incident_alerts.poll_loop()/log_retention.poll_loop()를
    일부러 기동하지 않는다(conftest.py의 datastore_clients 참고 - 실제 Slack 발송/
    OpenSearch 문서 삭제 부작용을 피하기 위함) - 그래서 /health가 503을 반환하는 게
    이 테스트 환경에서는 정상이다. 실제 배포 환경에서 /health가 503이면 진짜 장애다."""
    resp = await client.get("/health")
    assert resp.status_code == 503
    assert resp.json()["reason"] in (
        "alert poll task not started",
        "log retention poll task not started",
    )
