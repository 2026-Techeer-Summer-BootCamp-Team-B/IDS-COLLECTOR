-- "관리자 접속 기록" 보강. 세션 자체(활성 토큰)는 Redis(session:{token})에 있고
-- 로그아웃/만료되면 사라진다 - 반대로 "누가 언제 어떤 기기/브라우저로 접속했는지"의
-- 영구 기록은 audit_logs의 LOGIN/LOGOUT 행이 담당한다(app/auth.py). ip_address는
-- 이미 있었는데 User-Agent가 없어서 접속 기록으로는 부족했다.
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;
