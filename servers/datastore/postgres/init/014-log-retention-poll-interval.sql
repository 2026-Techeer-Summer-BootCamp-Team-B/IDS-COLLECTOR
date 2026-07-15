-- app/log_retention.py의 폴링 주기를 013-poll-intervals.sql과 동일한 패턴(admin이
-- PATCH /poll-intervals/log_retention_interval_seconds로 재배포 없이 조절)으로
-- 등록한다. delete_by_query가 인덱스 전체를 훑는 비교적 무거운 작업이라
-- alert_poll_interval_seconds(기본 5초)보다 훨씬 긴 기본값(1시간)을 쓴다.
INSERT INTO poll_intervals (key, seconds, description, min_seconds, max_seconds) VALUES
    (
        'log_retention_interval_seconds', 3600,
        '로그 보존기간(hot/cold) 집행 주기 - log_policies 기준 오래된 attack-logs-* 문서 삭제 (platform-api app/log_retention.py)',
        60, 86400
    )
ON CONFLICT (key) DO NOTHING;
