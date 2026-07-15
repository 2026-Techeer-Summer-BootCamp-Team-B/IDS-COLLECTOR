-- normalizer의 exclusion_rules 캐시 갱신 주기 (app/exclusion.py refresh_from_db) -
-- correlation-engine의 allow_list_refresh_seconds(013-poll-intervals.sql)와 동일한
-- 패턴/기본값. admin이 PATCH /poll-intervals/exclusion_rules_refresh_seconds로
-- 재배포 없이 조절 가능.
INSERT INTO poll_intervals (key, seconds, description, min_seconds, max_seconds) VALUES
    (
        'exclusion_rules_refresh_seconds', 30,
        'normalizer의 exclusion_rules 캐시 갱신 주기 (app/exclusion.py)',
        5, 600
    )
ON CONFLICT (key) DO NOTHING;
