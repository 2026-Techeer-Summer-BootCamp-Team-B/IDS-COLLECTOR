-- Slack/Discord 알림(app/incident_alerts.py)을 Redis pub/sub(incidents:events) 발화
-- 즉시 push 방식에서 폴링 방식으로 바꾸면서 필요해진 dedupe 마커. pub/sub는 재생이
-- 안 돼서 platform-api가 재시작/단절된 사이에 발화된 인시던트는 알림이 영구 유실됐는데,
-- 이 컬럼으로 "아직 알림 안 보낸 행"만 골라 보내면 그 문제가 사라진다(재시작해도
-- notified_at IS NULL인 행이 다음 폴링에서 그대로 잡힘).
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;
