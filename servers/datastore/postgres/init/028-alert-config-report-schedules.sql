ALTER TABLE alert_configs
    ADD COLUMN IF NOT EXISTS trend_report_schedule JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE alert_configs
SET trend_report_schedule = jsonb_build_array(jsonb_build_object(
    'days', jsonb_build_array(0, 1, 2, 3, 4, 5, 6),
    'time', trend_report_time
))
WHERE receive_trend_report AND trend_report_time IS NOT NULL AND trend_report_schedule = '[]'::jsonb;
