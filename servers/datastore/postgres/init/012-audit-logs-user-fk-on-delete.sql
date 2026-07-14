-- audit_logs.user_id FK가 ON DELETE 절 없이(기본 RESTRICT) 걸려 있어서, 로그인을
-- 한 번이라도 한 계정은 users_api.py의 delete_user가 영원히 못 지우는 문제가 있었다
-- (실측 확인: ForeignKeyViolationError). audit_logs_api.py의 원래 의도가 "계정이
-- 나중에 삭제돼도 감사 기록 자체는 남고 username만 조회가 안 되게" 하는 것이므로
-- ON DELETE SET NULL로 바꾼다 - 행을 지우지 않고 user_id만 null로 남긴다.
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_user_id_fkey;
ALTER TABLE audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
