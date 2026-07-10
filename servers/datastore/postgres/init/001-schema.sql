-- 관계형 뼈대: 메타데이터, 보안 룰, 인시던트 상태. 무결성 보장이 목적이라 여기서만
-- FK/CHECK 제약을 강하게 건다. 이벤트 원문 자체는 OpenSearch/ClickHouse 쪽에 있고,
-- 여긴 "무엇과 무엇이 어떻게 묶였는지"만 기록한다.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('admin', 'viewer');
CREATE TYPE attack_type AS ENUM ('was', 'waf', 'falco', 'audit');
CREATE TYPE detection_severity AS ENUM ('LOW', 'MEDIUM', 'CRITICAL');
CREATE TYPE correlation_key_type AS ENUM ('source.ip', 'user.name', 'orchestrator.resource.name');
CREATE TYPE incident_status AS ENUM ('open', 'investigating', 'closed');
CREATE TYPE audit_action AS ENUM (
    'RULE_CREATED', 'RULE_ENABLED', 'RULE_DISABLED',
    'IP_BANNED', 'IP_UNBANNED',
    'INCIDENT_STATUS_CHANGED'
);

-- 관리자 계정 (P5-2 인증이 참조).
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          user_role NOT NULL DEFAULT 'viewer',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 보호 대상 애플리케이션.
CREATE TABLE IF NOT EXISTS targets (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    base_url   TEXT NOT NULL,
    is_active  BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 예외 IP/대역 (특정 target에만 적용하고 싶으면 target_id로 스코프, 전역이면 NULL).
CREATE TABLE IF NOT EXISTS allow_list (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ip_or_cidr  TEXT NOT NULL,
    target_id   UUID REFERENCES targets(id),
    reason      TEXT,
    expires_at  TIMESTAMPTZ
);

-- 단일 이벤트 탐지 룰 (시그니처 매칭 - 아직 이걸 평가하는 서비스는 없음, 스키마만 준비).
CREATE TABLE IF NOT EXISTS detection_rules (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,
    attack_type         attack_type NOT NULL,
    pattern             TEXT NOT NULL,
    severity            detection_severity NOT NULL,
    enabled             BOOLEAN NOT NULL DEFAULT true,
    created_by          UUID REFERENCES users(id),
    mitre_technique_id  TEXT
);

-- 상관분석 시나리오 룰 (correlation-engine의 scenarios.yaml이 여기로 sync된다 - YAML이
-- source of truth, 이 테이블은 API 조회/감사용 캐시).
CREATE TABLE IF NOT EXISTS scenario_rules (
    id                    UUID PRIMARY KEY,
    name                  TEXT NOT NULL,
    required_modules      TEXT[] NOT NULL,
    correlation_key_type  correlation_key_type NOT NULL,
    time_window_seconds   INTEGER NOT NULL,
    min_severity          INTEGER NOT NULL DEFAULT 1,
    enabled               BOOLEAN NOT NULL DEFAULT true,
    created_by            UUID REFERENCES users(id),
    mitre_technique_id    TEXT
);

-- 상관분석에 의해 묶인 보안 사고.
CREATE TABLE IF NOT EXISTS incidents (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title                    TEXT NOT NULL,
    correlation_key_type     correlation_key_type NOT NULL,
    correlation_key_value    TEXT NOT NULL,
    severity                 INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 4),
    status                   incident_status NOT NULL DEFAULT 'open',
    matched_scenario_rule_id UUID REFERENCES scenario_rules(id),
    mitre_tactics            TEXT[] NOT NULL DEFAULT '{}',
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents (status);

-- 발화 멱등성(같은 시나리오+상관키로 이미 open인 인시던트가 있으면 병합)을 DB 레벨에서도 강제.
CREATE UNIQUE INDEX IF NOT EXISTS idx_incidents_open_dedup
    ON incidents (matched_scenario_rule_id, correlation_key_value) WHERE status = 'open';

-- 인시던트 <-> 이벤트 매핑. event_id는 OpenSearch/ClickHouse의 event_id(dedupe 키)를
-- 문자열로만 참조한다 - 교차 저장소라 FK 제약을 걸 수 없다.
CREATE TABLE IF NOT EXISTS incident_events (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id   UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    event_id      TEXT NOT NULL,
    event_module  TEXT NOT NULL,
    added_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incident_events_incident ON incident_events (incident_id);

-- 관리자 행위 감사 로그.
CREATE TABLE IF NOT EXISTS audit_logs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID REFERENCES users(id),
    action       audit_action NOT NULL,
    target_table TEXT,
    ip_address   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
