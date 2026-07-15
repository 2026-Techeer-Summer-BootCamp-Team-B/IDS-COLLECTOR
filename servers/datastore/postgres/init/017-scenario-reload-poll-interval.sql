-- correlation-engine이 app/scenarios/*.yaml을 주기적으로 다시 읽는 간격
-- (2026-07-15, app/main.py의 _scenario_reload_loop). 예전엔 엔진 기동 시 딱
-- 한 번만 로드해서 시나리오를 추가/수정하려면 재배포가 필요했다 - 013-poll-
-- intervals.sql의 allow_list_refresh_seconds와 동일한 "poll_intervals 행이
-- 없으면 코드 기본값으로 fail-open" 패턴.
INSERT INTO poll_intervals (key, seconds, description, min_seconds, max_seconds) VALUES
    (
        'scenario_reload_seconds', 30,
        'correlation-engine의 시나리오(app/scenarios/*.yaml) 재로드 주기',
        5, 600
    )
ON CONFLICT (key) DO NOTHING;
