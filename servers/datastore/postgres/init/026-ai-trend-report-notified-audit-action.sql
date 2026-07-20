-- 기존 버그: app/main.py의 POST /reports/trend/notify가 record_action()에
-- 'AI_TREND_REPORT_NOTIFIED'를 넘기는데, 이 값이 audit_action enum에 없어서
-- 호출할 때마다 "invalid input value for enum audit_action" 500이 났다(실측
-- 확인, 2026-07-18 - 새 Postgres에 001~025 마이그레이션만 적용한 상태에서 이
-- 엔드포인트를 처음 호출해보고 발견). 003/006/025와 같은 패턴으로 누락된 값만 추가.
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'AI_TREND_REPORT_NOTIFIED';
