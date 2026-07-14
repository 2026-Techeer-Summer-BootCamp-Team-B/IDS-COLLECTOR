#!/usr/bin/env bash
# 초기 관리자 계정 시드 (P5-2 실사용자 연동). app/auth.py가 이 테이블 행을 실제로
# 조회/검증한다(001-schema.sql에서 이미 켠 pgcrypto의 crypt()/gen_salt('bf')로 해시).
#
# 하드코딩된 기본 비밀번호를 두지 않기 위해 ADMIN_INITIAL_PASSWORD(.env, env_file로
# 컨테이너에 주입됨)가 없으면 시드 자체를 건너뛴다 - 이 경우 admin 계정 없이 뜨므로
# 로그인하려면 아래 "이미 떠 있는 서버" 안내대로 사람이 직접 채워야 한다.
#
# 주의: docker-entrypoint-initdb.d의 스크립트는 Postgres 데이터 디렉터리가 비어있을
# 때(최초 기동) 한 번만 실행된다 - 이미 떠 있는 서버는 이 스크립트가 다시 실행되지
# 않으므로, 비밀번호를 바꾸거나 나중에 채우려면 psql로 users 테이블을 직접
# 교체해야 한다:
#   UPDATE users SET password_hash = crypt('새비밀번호', gen_salt('bf')) WHERE username = 'admin';
# (계정이 아예 없는 상태였다면 UPDATE 대신 이 파일의 INSERT 문을 그대로 psql에 붙여넣을 것.)
set -e

if [ -z "$ADMIN_INITIAL_PASSWORD" ]; then
    echo "[005-seed-admin-user] WARNING: ADMIN_INITIAL_PASSWORD 미설정 - 초기 관리자 계정 시드를 건너뜁니다. admin 계정 없이 기동됩니다(로그인 불가) - servers/datastore/postgres/.env.example 참고." >&2
else
    psql -v ON_ERROR_STOP=1 -v admin_password="$ADMIN_INITIAL_PASSWORD" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-'EOSQL'
        INSERT INTO users (username, password_hash, role)
        VALUES ('admin', crypt(:'admin_password', gen_salt('bf')), 'admin')
        ON CONFLICT (username) DO NOTHING;
EOSQL
fi
