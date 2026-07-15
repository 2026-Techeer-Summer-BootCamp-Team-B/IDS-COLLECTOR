-- 데이터 정책(로그 보존/샘플링) + 제외 규칙. dashboard/src/data/logPolicy.js의
-- INITIAL_LOG_POLICIES/INITIAL_EXCLUSION_RULES가 지금까지 프론트 로컬 mock
-- state로만 존재했던 걸 실제 테이블로 옮긴다. 초기 시드값은 그 mock 데이터와
-- 동일하게 넣어서, 나중에 프론트를 진짜 API 호출로 바꿔도 화면에 보이는 값이
-- 바뀌지 않는다.

-- layer가 WAS/Falco/K8s Audit 3개로 고정된 계층별 정책이라 PK로 쓴다(생성/삭제
-- API 없음 - PATCH로 값만 바꿈).
CREATE TABLE IF NOT EXISTS log_policies (
    layer            TEXT PRIMARY KEY,
    hot_days         INTEGER NOT NULL,
    cold_days        INTEGER NOT NULL,
    sampling_rate    INTEGER NOT NULL,
    archive_enabled  BOOLEAN NOT NULL DEFAULT true,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO log_policies (layer, hot_days, cold_days, sampling_rate, archive_enabled) VALUES
    ('WAS', 7, 90, 100, true),
    ('Falco', 3, 30, 20, true),
    ('K8s Audit', 14, 180, 100, true)
ON CONFLICT (layer) DO NOTHING;

-- id는 프론트 mock과 동일한 사람이 읽는 코드(EX-01 등)를 그대로 PK로 쓴다 - 작고
-- 수동으로 큐레이션되는 목록이라 UUID로 바꿀 이유가 없다.
CREATE TABLE IF NOT EXISTS exclusion_rules (
    id                      TEXT PRIMARY KEY,
    layer                   TEXT NOT NULL,
    pattern                 TEXT NOT NULL,
    reason                  TEXT,
    estimated_reduction_pct INTEGER NOT NULL DEFAULT 0,
    enabled                 BOOLEAN NOT NULL DEFAULT true,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO exclusion_rules (id, layer, pattern, reason, estimated_reduction_pct, enabled) VALUES
    ('EX-01', 'Falco', 'rule="Contact K8S API Server From Container"',
     '정상 컨트롤러 트래픽 — 전체 Falco 이벤트의 절반 이상을 차지하는 저가치 NOTICE 노이즈', 55, true),
    ('EX-02', 'K8s Audit', 'verb IN (get, watch) AND user =~ "system:serviceaccount:.*"',
     '서비스어카운트의 routine reconcile 호출 — 보안 신호 아님', 40, true),
    ('EX-03', 'WAS', 'path="/api/v1/health"',
     '헬스체크 폴링 — 초 단위 반복 호출로 로그량만 증가', 8, true),
    ('EX-04', 'Falco', 'level=DEBUG AND source="collector"',
     '디버그 빌드 잔재 로그', 3, false)
ON CONFLICT (id) DO NOTHING;

-- targets/allow_list/alert_configs/users와 동일한 패턴(003/006/011-audit-actions 참고).
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'LOG_POLICY_UPDATED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'EXCLUSION_RULE_TOGGLED';
