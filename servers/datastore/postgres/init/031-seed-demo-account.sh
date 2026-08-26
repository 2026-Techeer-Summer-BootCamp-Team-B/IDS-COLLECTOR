#!/usr/bin/env bash
# 평가/테스트용 공개 데모 계정 시드. 005-seed-admin-user.sh와 같은 패턴 -
# DEMO_ACCOUNT_PASSWORD(.env, env_file로 컨테이너에 주입됨)가 없으면 시드를
# 건너뛴다. 대시보드 로그인 화면의 "로그인 없이 둘러보기" 버튼(LoginScreen.jsx)이
# 이 계정(username: demo)으로 자동 로그인한다 - 평가자가 별도 자격증명 없이도
# 룰 토글/인시던트 상태변경/IP 차단 등 admin 전용 쓰기 기능까지 전부 테스트할 수
# 있도록 role을 admin으로 시드한다.
#
# 주의: 이 계정의 자격증명은 대시보드 프론트엔드 번들에 그대로 노출된다
# (dashboard/.env의 VITE_DEMO_PASSWORD) - 이 계정으로는 진짜 운영 데이터를
# 다루지 않는 환경에서만 활성화할 것.
#
# docker-entrypoint-initdb.d 스크립트는 Postgres 데이터 디렉터리가 비어있을 때
# (최초 기동) 한 번만 실행된다 - 이미 떠 있는 서버라면 아래 INSERT 문을 psql에
# 직접 붙여넣을 것.
set -e

if [ -z "$DEMO_ACCOUNT_PASSWORD" ]; then
    echo "[031-seed-demo-account] WARNING: DEMO_ACCOUNT_PASSWORD 미설정 - 데모 계정 시드를 건너뜁니다." >&2
else
    psql -v ON_ERROR_STOP=1 -v demo_password="$DEMO_ACCOUNT_PASSWORD" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-'EOSQL'
        INSERT INTO users (username, password_hash, role)
        VALUES ('demo', crypt(:'demo_password', gen_salt('bf')), 'admin')
        ON CONFLICT (username) DO NOTHING;
EOSQL
fi
