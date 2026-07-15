-- idx_incidents_open_dedup(001-schema.sql)는 status='open'인 인시던트만 병합
-- 대상으로 봤다 - 그래서 분석가가 "조사중(investigating)"으로 옮겨놓은, 즉 아직
-- 해결 못 한 인시던트에 같은 공격이 또 들어오면 병합되지 않고 매번 새 인시던트가
-- 생겼다(2026-07-15, 실측 확인 - correlation-engine/app/incidents.py의
-- upsert_incident 참고). "조사중"은 아직 미해결 상태이므로 open과 마찬가지로
-- 이미 진행 중인 그 인시던트로 합쳐져야 맞고, "종결(closed)"만 "이 공격 유형은
-- 해결됐다"는 뜻이라 새 인시던트를 만드는 게 맞다.
DROP INDEX IF EXISTS idx_incidents_open_dedup;

CREATE UNIQUE INDEX IF NOT EXISTS idx_incidents_active_dedup
    ON incidents (matched_scenario_rule_id, correlation_key_value)
    WHERE status IN ('open', 'investigating');
