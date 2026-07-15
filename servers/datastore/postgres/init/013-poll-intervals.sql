-- 폴링/자동 실행 주기를 재배포(재시작) 없이 조절할 수 있게 하는 설정 테이블
-- (2026-07-15). 지금까지 alert_poll_interval_seconds(platform-api Settings, env var라
-- 바꾸려면 컨테이너 재시작 필요)/correlation-engine의 allow_list 갱신 주기(코드에
-- 아예 하드코딩, env var조차 없었음) 둘 다 고정값이었다. 각 폴링 루프가 매 반복마다
-- 이 테이블 값을 다시 읽게 바꿔서(app/incident_alerts.py, correlation-engine/app/main.py)
-- admin이 PATCH /poll-intervals/{key}로 바꾸면 다음 반복부터 바로 반영된다 -
-- scenario_rules.enabled와 같은 "런타임에 admin이 바꾸는 설정" 패턴.
--
-- id를 따로 두는 이유: audit_logs.record_id가 UUID 컬럼이라(폴리모픽 참조, 여러
-- 테이블을 가리킬 수 있어 단일 REFERENCES 대신 UUID만 저장 - app/audit.py 참고)
-- key(TEXT)를 그대로 못 넣는다 - 다른 admin CRUD 테이블(alert_configs 등)과 동일하게
-- UUID PK를 두고, key는 API 경로/조회용 자연키로 별도 유지.
--
-- key는 고정 목록이다(임의 키 생성 API는 없음) - 새 폴링 루프가 생기면 마이그레이션에
-- INSERT 행 하나 추가하고 그 루프가 해당 key로 조회하도록 고치는 방식.
CREATE TABLE IF NOT EXISTS poll_intervals (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key         TEXT NOT NULL UNIQUE,
    seconds     INTEGER NOT NULL,
    description TEXT NOT NULL,
    min_seconds INTEGER NOT NULL DEFAULT 1,
    max_seconds INTEGER NOT NULL DEFAULT 3600,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- audit_action enum에 이 API의 PATCH 행위 추가 (다른 admin CRUD와 동일 패턴, 003/006/
-- 011번 마이그레이션 참고) - 없으면 app/audit.py의 record_action()이 INSERT 시점에
-- "invalid input value for enum audit_action" 500을 낸다(실측 확인).
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'POLL_INTERVAL_UPDATED';

INSERT INTO poll_intervals (key, seconds, description, min_seconds, max_seconds) VALUES
    (
        'alert_poll_interval_seconds', 5,
        'Slack/Discord 알림 발송 폴링 주기 (platform-api app/incident_alerts.py)',
        1, 300
    ),
    (
        'allow_list_refresh_seconds', 30,
        'correlation-engine의 allow_list 캐시 갱신 주기 (correlation-engine app/main.py)',
        5, 600
    ),
    (
        -- 2026-07-15 추가: 대시보드 쪽 폴링 주기를 admin이 재배포 없이 조절할 수
        -- 있게 하려고 행을 미리 만들어뒀다 - 지금은 이 값을 실제로 읽어가는
        -- 프론트 코드가 아직 없다(dashboard/src/data/timeSeries.js의
        -- LIVE_POLL_MS=2000, dashboard/src/context/PollIntervalContext.jsx가
        -- 여전히 그 상수를 기본값으로 쓰고 브라우저 localStorage에만 저장 -
        -- GET /poll-intervals 호출 자체가 없음, 2026-07-15 확인). 대시보드가 이
        -- 값을 실제로 불러오게 하는 작업은 별도 범위(다른 팀 작업 중).
        'dashboard_live_poll_seconds', 2,
        '대시보드 실시간 위젯(KPI/차트/Recent Logs/라이브 티커 등) 폴링 주기 - 프론트 미연동',
        1, 60
    ),
    (
        -- 2026-07-15 추가: 마찬가지로 아직 프론트 미연동 - dashboard/src/hooks/
        -- useIncidentsSocket.js가 POLL_INTERVAL_MS=5000 하드코딩 상수를 그대로
        -- setInterval에 쓰고, 이 테이블 값은 안 읽는다.
        'dashboard_incidents_poll_seconds', 5,
        '대시보드 인시던트 목록 재조회 주기 - 프론트 미연동',
        1, 60
    )
ON CONFLICT (key) DO NOTHING;
