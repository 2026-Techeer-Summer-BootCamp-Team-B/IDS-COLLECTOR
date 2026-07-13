-- 초기 관리자 계정 시드 (P5-2 실사용자 연동). app/auth.py가 이제 이 테이블 행을 실제로
-- 조회/검증한다(001-schema.sql에서 이미 켠 pgcrypto의 crypt()/gen_salt('bf')로 해시).
-- username/password는 기존 하드코딩 스텁 기본값(admin/changeme)과 동일하게 유지해
-- dev 환경 로그인 흐름을 깨지 않는다 - 운영 배포 전 반드시 교체할 것.
INSERT INTO users (username, password_hash, role)
VALUES ('admin', crypt('changeme', gen_salt('bf')), 'admin')
ON CONFLICT (username) DO NOTHING;
