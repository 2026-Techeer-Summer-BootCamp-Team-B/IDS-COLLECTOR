"""/health가 "컨슈머 태스크는 살아있지만 이벤트가 연속으로 조용히 버려지는 중"인
상태(Redis/Postgres 장애로 evaluate/upsert 재시도가 매번 소진되는 경우)를 감지하는지
검증한다 - 예전엔 컨슈머 태스크 생존 여부만 봐서 이 경우 계속 200/ok를 반환했다
(2026-07-21)."""
import pytest

import app.main as main


@pytest.fixture(autouse=True)
def _reset_health_state():
    """모듈 전역 상태라 테스트끼리 오염되지 않도록 매 테스트 전후로 초기화한다."""
    original = (main._consumer_task, main._consecutive_drop_count, main._last_drop_error)
    main._consumer_task = None
    main._consecutive_drop_count = 0
    main._last_drop_error = None
    yield
    main._consumer_task, main._consecutive_drop_count, main._last_drop_error = original


class _FakeTask:
    def __init__(self, done: bool):
        self._done = done

    def done(self) -> bool:
        return self._done


class TestUnhealthyReason:
    def test_task_not_started_is_unhealthy(self):
        assert main._unhealthy_reason() == "consumer task not started"

    def test_task_exited_is_unhealthy(self):
        main._consumer_task = _FakeTask(done=True)
        assert main._unhealthy_reason() == "consumer task exited"

    def test_alive_task_with_no_drops_is_healthy(self):
        main._consumer_task = _FakeTask(done=False)
        assert main._unhealthy_reason() is None

    def test_alive_task_with_drops_below_threshold_is_healthy(self):
        """poison pill 이벤트 한두 건이 재시도 소진 후 스킵되는 건 정상 운영 범위 -
        연속 드롭이 임계치 밑이면 /health는 여전히 ok여야 한다."""
        main._consumer_task = _FakeTask(done=False)
        main._consecutive_drop_count = main._UNHEALTHY_CONSECUTIVE_DROPS - 1
        assert main._unhealthy_reason() is None

    def test_alive_task_with_drops_at_threshold_is_unhealthy(self):
        """Redis/Postgres 장애로 이벤트가 연속으로 버려지는 상황을 재현 - 컨슈머
        태스크는 죽지 않았으므로 예전 _dead_task_reason()만으로는 못 잡았다."""
        main._consumer_task = _FakeTask(done=False)
        main._consecutive_drop_count = main._UNHEALTHY_CONSECUTIVE_DROPS
        main._last_drop_error = "connection refused"
        reason = main._unhealthy_reason()
        assert reason is not None
        assert "connection refused" in reason

    def test_success_after_drops_resets_health(self):
        """_consume_loop이 성공 시 카운터를 0으로 리셋하는 것과 동일한 상태 전이를
        검증 - 일시적 장애가 회복되면 /health도 다시 ok로 돌아와야 한다."""
        main._consumer_task = _FakeTask(done=False)
        main._consecutive_drop_count = main._UNHEALTHY_CONSECUTIVE_DROPS
        main._consecutive_drop_count = 0  # _consume_loop의 성공 경로가 하는 것과 동일
        assert main._unhealthy_reason() is None
