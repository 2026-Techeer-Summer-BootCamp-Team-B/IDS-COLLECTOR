-- 알림 채널 설정 CRUD 대상 (AlertConfig API, P5-3). 지금까지는 platform-api의
-- SLACK_WEBHOOK_URL/DISCORD_WEBHOOK_URL 환경변수 고정값이었는데, 이 테이블로 옮겨서
-- 런타임에 여러 채널을 등록/토글할 수 있게 한다 (app/notifications.py가 이 테이블을 조회).
CREATE TYPE alert_channel_type AS ENUM ('slack', 'discord');

CREATE TABLE IF NOT EXISTS alert_configs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_type alert_channel_type NOT NULL,
    webhook_url  TEXT NOT NULL,
    enabled      BOOLEAN NOT NULL DEFAULT true,
    min_severity INTEGER NOT NULL DEFAULT 4,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
