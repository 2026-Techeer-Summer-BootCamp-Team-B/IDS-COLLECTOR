-- audit_action enum에 사용자 관리 CRUD 행위 추가 (users_api.py가 기록, AuditLog API가
-- 조회) - targets/allow_list/alert_configs와 동일한 패턴(003/006-audit-actions 참고).
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'USER_CREATED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'USER_UPDATED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'USER_DELETED';
