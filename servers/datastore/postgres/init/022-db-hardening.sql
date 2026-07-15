-- DB 구조 점검(2026-07-15) 후 발견한 항목 일괄 수정. 실측(EXPLAIN ANALYZE, 기존
-- 데이터 검증) 후 적용 - 전부 기존 데이터와 호환됨을 확인. 전체를 트랜잭션으로
-- 묶어서 중간에 하나라도 실패하면 전부 롤백되게 한다(부분 적용 방지).
BEGIN;

-- 1) FK 삭제 정책 누락 - incidents.verdict_by/scenario_rules.created_by가
-- users(id)를 기본 RESTRICT로 참조하고 있었다. incidents_api.py의
-- update_verdict()가 verdict_by를 실제로 채우므로, 어떤 분석가가 인시던트에
-- 정답 라벨을 한 번이라도 달면 그 계정을 DELETE /users/{id}로 지울 때 FK 위반
-- 500 에러가 난다(users_api.py delete_user()가 이 예외를 처리하지 않음) - 바로
-- 옆의 audit_logs.user_id가 이미 쓰고 있는 ON DELETE SET NULL과 동일하게 맞춘다.
ALTER TABLE incidents
    DROP CONSTRAINT incidents_verdict_by_fkey,
    ADD CONSTRAINT incidents_verdict_by_fkey
        FOREIGN KEY (verdict_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE scenario_rules
    DROP CONSTRAINT scenario_rules_created_by_fkey,
    ADD CONSTRAINT scenario_rules_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

-- 2) 인덱스 누락 - 지금은 행 수가 적어(incidents 74건, audit_logs 83건) 체감이
-- 안 되지만 EXPLAIN ANALYZE로 확인한 결과 둘 다 이미 Seq Scan + explicit Sort를
-- 타고 있다. incidents는 대시보드가 3~5초마다 폴링하는 핫 패스라 데이터가 늘면
-- 가장 먼저 느려질 지점.
--   - incidents: GET /incidents가 status로 필터링한 뒤 updated_at(또는
--     since 폴링일 땐 created_at) + id로 정렬(키셋 페이지네이션) - 기존
--     idx_incidents_status는 정렬에 못 쓰이므로 복합 인덱스로 교체.
DROP INDEX IF EXISTS idx_incidents_status;
CREATE INDEX idx_incidents_status_updated ON incidents (status, updated_at DESC, id DESC);
CREATE INDEX idx_incidents_created ON incidents (created_at, id);

--   - audit_logs: audit_logs_api.py의 커서 페이지네이션(ORDER BY created_at
--     DESC, id DESC)을 뒷받침하는 인덱스가 없었다.
CREATE INDEX idx_audit_logs_created ON audit_logs (created_at DESC, id DESC);

--   - allow_list.target_id: FK인데 인덱스가 없어서 correlation-engine의
--     allow_list 캐시 갱신 쿼리(targets JOIN)와 targets_api.py delete_target()의
--     참조 카운트 체크가 매번 allow_list 풀스캔이었다.
CREATE INDEX idx_allow_list_target ON allow_list (target_id);

--   - banned_ips.ip_or_cidr: ban_ip()가 재차단 시 "이 IP 몇 번째 차단인지"
--     계산하려고 매번 전체 스캔했다.
CREATE INDEX idx_banned_ips_ip ON banned_ips (ip_or_cidr);

-- 3) CHECK 제약 누락 - incidents.severity(CHECK 1~4)와 같은 성격의 값인데
-- 지금까지 애플리케이션 레벨(포스트/패치 핸들러)에서만 검증되고 있었다. DB
-- 레벨에서도 막아서 다른 경로(직접 psql, 향후 배치 스크립트 등)로 잘못된 값이
-- 들어가는 걸 방지한다.
ALTER TABLE log_policies
    ADD CONSTRAINT log_policies_sampling_rate_check CHECK (sampling_rate BETWEEN 0 AND 100);

ALTER TABLE alert_configs
    ADD CONSTRAINT alert_configs_min_severity_check CHECK (min_severity BETWEEN 1 AND 4);

ALTER TABLE scenario_rules
    ADD CONSTRAINT scenario_rules_min_severity_check CHECK (min_severity BETWEEN 1 AND 4);

ALTER TABLE poll_intervals
    ADD CONSTRAINT poll_intervals_bounds_check
        CHECK (min_seconds <= max_seconds AND seconds BETWEEN min_seconds AND max_seconds);

-- 4) allow_list 중복 방지 - 같은 IP/CIDR을 같은 target(또는 둘 다 전역)에 실수로
-- 두 번 등록해도 막을 방법이 없었다. target_id가 NULL이면(전역 항목) 일반
-- UNIQUE 제약은 NULL끼리 서로 다르다고 취급해 안 걸러지므로, 부분 유니크
-- 인덱스 2개로 나눠서 스코프별/전역별 각각 중복을 막는다. banned_ips는 재차단
-- 이력을 남기는 게 의도된 설계(hit_count)라 대상에서 제외.
CREATE UNIQUE INDEX idx_allow_list_unique_scoped ON allow_list (ip_or_cidr, target_id)
    WHERE target_id IS NOT NULL;
CREATE UNIQUE INDEX idx_allow_list_unique_global ON allow_list (ip_or_cidr)
    WHERE target_id IS NULL;

-- 5) ip_or_cidr을 TEXT에서 inet으로 - 지금까지 형식 검증(ipaddress.ip_network())이
-- 애플리케이션 레벨에만 있었다. inet은 DB 레벨에서부터 형식을 보장하고, 호스트
-- 비트가 있는 값("10.0.0.5/24" 같은 단일 주소+마스크)도 그대로 받아들여서
-- (cidr 타입과 달리 거부하지 않음) 기존 입력 의미를 안 바꾼다 - asyncpg는 바인딩
-- 시 일반 문자열을 그대로 받고(플랫폼-api 컨테이너에서 실측 확인), 조회 시엔
-- ipaddress.IPv4Interface로 돌려주므로 애플리케이션 코드(allow_list_api.py/
-- banned_ips_api.py의 _row_to_out, correlation-engine의
-- incidents.fetch_active_allow_list)가 str()로 감싸도록 같이 수정했다.
ALTER TABLE allow_list ALTER COLUMN ip_or_cidr TYPE inet USING ip_or_cidr::inet;
ALTER TABLE banned_ips ALTER COLUMN ip_or_cidr TYPE inet USING ip_or_cidr::inet;

COMMIT;
