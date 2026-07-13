-- 운영 추적성 보강 (2026-07-13). ERD 설계 검토에서 나온 4가지 공백을 메운다:
-- 1) audit_logs가 "어떤 테이블"만 기록하고 "어느 행"인지는 기록 못 하던 것 보완
-- 2) users/targets/scenario_rules/allow_list의 created_at/updated_at 불일치 해소
-- 3) banned_ips에 "이 IP가 몇 번째 차단인지" 누적 카운터 추가

-- 1) audit_logs.record_id - target_table 안에서 실제로 바뀐 행의 PK. 여러 테이블을
-- 가리킬 수 있는 폴리모픽 참조라 단일 REFERENCES는 걸 수 없어 순수 UUID로만 둔다.
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS record_id UUID;

-- 2) updated_at 일관성. alert_configs/banned_ips는 이미 있었고(각각 002/004), 나머지
-- 테이블에 없던 게 불일치였다. scenario_rules/allow_list는 created_at도 아예 없었다.
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE targets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE scenario_rules ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE scenario_rules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE allow_list ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE allow_list ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 3) banned_ips.hit_count - 이 IP/대역이 지금까지 몇 번째 차단인지(재차단 포함 누적).
-- app/banned_ips_api.py의 ban_ip()가 같은 ip_or_cidr의 과거 최대 hit_count+1로 채운다.
ALTER TABLE banned_ips ADD COLUMN IF NOT EXISTS hit_count INTEGER NOT NULL DEFAULT 1;
