ALTER TABLE alert_configs ADD COLUMN IF NOT EXISTS trend_report_sent_slots JSONB NOT NULL DEFAULT '{}'::jsonb;
