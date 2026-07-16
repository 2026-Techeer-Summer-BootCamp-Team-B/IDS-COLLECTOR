-- 탐지 품질 피드백 루프 (2026-07-15). incidents.status(open/investigating/closed)는
-- 처리 생명주기일 뿐 "이 탐지가 실제로 맞았는가"를 기록하는 필드가 아니었다 - 그래서
-- precision/recall 같은 탐지 품질 지표를 낼 근거 자체가 없었고, 분석가가 오탐을
-- 표시할 방법도 없어서 시나리오 threshold/window/cooldown을 데이터 기반으로 튜닝할
-- 수가 없었다. status와 완전히 별개 축으로 verdict(정답 라벨)를 둔다 - status는
-- "지금 처리가 어느 단계인지", verdict는 "이 판정이 맞았는지"라 서로 독립적이다
-- (예: investigating 상태에서도 이미 오탐임을 알 수 있고, closed로 넘어간 뒤에도
-- 아직 verdict를 안 남겨서 NULL로 남아있을 수 있다).
CREATE TYPE incident_verdict AS ENUM ('true_positive', 'false_positive');

ALTER TABLE incidents
    ADD COLUMN IF NOT EXISTS verdict      incident_verdict,
    ADD COLUMN IF NOT EXISTS verdict_note TEXT,
    ADD COLUMN IF NOT EXISTS verdict_by   UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS verdict_at   TIMESTAMPTZ;

-- 다른 admin 판단 행위(INCIDENT_STATUS_CHANGED 등)와 동일하게 감사 로그에 남긴다
-- (003/006/011/013번 마이그레이션과 같은 패턴 - audit_logs.record_id가 이 값을
-- 참조하려면 enum에 값이 먼저 있어야 하고, 없으면 app/audit.py의 record_action()이
-- INSERT 시점에 "invalid input value for enum audit_action" 500을 낸다).
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'INCIDENT_VERDICT_SET';

-- scenarios_api.py의 precision 집계(scenario별 true_positive/false_positive count)가
-- matched_scenario_rule_id+verdict로 묶어서 조회하므로 인덱스를 둔다.
CREATE INDEX IF NOT EXISTS idx_incidents_scenario_verdict
    ON incidents (matched_scenario_rule_id, verdict);
