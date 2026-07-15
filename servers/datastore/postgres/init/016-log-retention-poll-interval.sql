-- app/log_retention.py의 폴링 주기를 014-poll-intervals.sql과 동일한 패턴(admin이
-- PATCH /poll-intervals/log_retention_interval_seconds로 재배포 없이 조절)으로
-- 등록한다. 인덱스 목록 조회+삭제가 비교적 무거운 작업이라
-- alert_poll_interval_seconds(기본 5초)보다 훨씬 긴 기본값(1시간)을 쓴다.
--
-- description 문구는 2026-07-16에 갱신됨(3등급 보존 체계 도입, 023-log-policies-
-- retention-tiers.sql) - 원래는 "hot/cold 집행"·"attack-logs-* 문서 삭제"였는데,
-- 실제로는 인덱스 통삭제 + Postgres 1등급 정리까지 하므로 description을 실제
-- 동작에 맞게 고쳤다(이 UPDATE는 최초 INSERT 이후 값이 바뀐 배포 서버에도
-- 적용되도록 별도로 둔다 - INSERT ... ON CONFLICT DO NOTHING은 이미 존재하는
-- 행에는 효과가 없음).
INSERT INTO poll_intervals (key, seconds, description, min_seconds, max_seconds) VALUES
    (
        'log_retention_interval_seconds', 3600,
        '데이터 보존기간 집행 주기 - attack-logs-*/otel-logs-raw-* 인덱스 통삭제 + '
        'Postgres 1등급(기록) 정리 (platform-api app/log_retention.py)',
        60, 86400
    )
ON CONFLICT (key) DO NOTHING;

UPDATE poll_intervals
SET description = '데이터 보존기간 집행 주기 - attack-logs-*/otel-logs-raw-* 인덱스 통삭제 + '
                   'Postgres 1등급(기록) 정리 (platform-api app/log_retention.py)'
WHERE key = 'log_retention_interval_seconds';
