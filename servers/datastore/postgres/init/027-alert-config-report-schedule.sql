-- Webhook 채널별 수신 범위와 AI 트렌드 리포트 일일 발송 시각(KST)을 분리한다.
ALTER TABLE alert_configs
    ADD COLUMN IF NOT EXISTS receive_incidents BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS receive_trend_report BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS trend_report_time TEXT,
    ADD COLUMN IF NOT EXISTS trend_report_last_sent_date DATE;

ALTER TABLE alert_configs
    ADD CONSTRAINT alert_configs_trend_report_time_check
    CHECK (trend_report_time IS NULL OR trend_report_time ~ '^[0-2][0-9]:[0-5][0-9]$');
