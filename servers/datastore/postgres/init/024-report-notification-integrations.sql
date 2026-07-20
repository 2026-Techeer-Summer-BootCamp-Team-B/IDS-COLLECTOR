-- AI 트렌드 리포트(app/ai_report.py) 스케줄 발송용 Slack/Discord 연동 (사용자별 OAuth
-- 연동 - app/alert_configs_api.py의 alert_configs와는 별개 테이블이다: alert_configs는
-- 인시던트 실시간 알림용 고정 webhook URL 하나를 관리자가 직접 붙여넣는 방식이고,
-- 이 테이블은 사용자 각자가 자신의 워크스페이스/서버를 OAuth로 연결해두는 방식이라
-- 계정별(user_id)로 분리된다. OAuth 발급은 아직 Slack/Discord 앱 등록 전이라 지금은
-- access_token에 목업 문자열이 들어간다(app/report_notifications_api.py의
-- connect 엔드포인트 참고) - 나중에 실제 토큰이 들어와도 스키마/암복호화 경로는
-- 그대로 재사용된다.
CREATE TYPE report_notification_platform AS ENUM ('slack', 'discord');

CREATE TABLE IF NOT EXISTS report_notification_connections (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform                 report_notification_platform NOT NULL,
    -- app/crypto_utils.py(Fernet)로 암호화한 값만 저장한다 - 평문 토큰은 절대 컬럼에
    -- 들어가지 않는다(목업 문자열도 동일하게 암호화해서 저장 - 실제 토큰으로
    -- 교체됐을 때 이 컬럼/암복호화 경로를 그대로 재사용하기 위함).
    access_token_encrypted   TEXT NOT NULL,
    workspace_or_server_name TEXT NOT NULL,
    channel_id               TEXT NOT NULL,
    enabled                  BOOLEAN NOT NULL DEFAULT true,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- 사용자당 플랫폼별 연동은 하나만 - 재연결(다시 "연결하기")은 새로 INSERT가
    -- 아니라 기존 행을 갱신하는 UPSERT로 처리한다(app/report_notifications_api.py).
    UNIQUE (user_id, platform)
);

-- 스케줄 리포트 발송 시도 이력("최근 전송 내역"). connection_id는 연동 해제 후에도
-- 이력 자체는 남아야 하므로 ON DELETE SET NULL - platform/channel_id를 여기에도
-- 중복 저장해두는 이유이기도 하다(연동이 지워져도 "어디로 보내려 했는지"가
-- history만으로 계속 조회 가능해야 함).
CREATE TABLE IF NOT EXISTS report_notification_history (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID REFERENCES report_notification_connections(id) ON DELETE SET NULL,
    platform      report_notification_platform NOT NULL,
    channel_id    TEXT NOT NULL,
    status        TEXT NOT NULL, -- 'success' | 'failed'
    mocked        BOOLEAN NOT NULL DEFAULT true,
    error_message TEXT,
    sent_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_notification_history_sent_at
    ON report_notification_history (sent_at DESC);
