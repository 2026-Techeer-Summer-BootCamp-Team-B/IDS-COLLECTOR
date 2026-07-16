-- 데이터 3등급 보존 체계로 log_policies 재정의 (docs/reports/repo-audit-20260715.md
-- §3.1, docs/파이프라인 계약v1.2.md 보존 정책 섹션, 2026-07-16).
--
-- 기존 hot_days/cold_days 2필드는 이름만 "hot/cold tier"였을 뿐, OpenSearch가 단일
-- 노드 dev 구성이라 실제 계층형 저장소 분리는 애초에 불가능했다(archive_enabled=false면
-- cold_days를 그냥 무시하는 식으로 우회 - app/log_retention.py 구주석 참고).
-- sampling_rate는 저장/조회만 되고 어디에서도 읽어 집행하지 않는 죽은 컨트롤이었다
-- (위 감사 §3.1). 둘 다 걷어내고 단일 retention_days로 정직화한다.
--
-- 레이어 구분도 소스별(WAS/Falco/K8s Audit)에서 3등급 체계(기록/원본/파생)로
-- 바꾼다 - app/log_retention.py가 이제 event.module별이 아니라 인덱스/테이블
-- 단위로 통삭제하므로, 소스별 레이어 구분 자체가 더 이상 실행 의미를 갖지 않는다.
--
-- ⚠️ 이 마이그레이션은 022-db-hardening.sql이 sampling_rate에 건 CHECK 제약
-- (log_policies_sampling_rate_check) 이후에 실행돼야 한다 - DROP COLUMN이 그
-- 제약을 자동으로 같이 지운다.
ALTER TABLE log_policies
    ADD COLUMN IF NOT EXISTS retention_days INTEGER;

UPDATE log_policies SET retention_days = hot_days + cold_days WHERE retention_days IS NULL;

ALTER TABLE log_policies
    ALTER COLUMN retention_days SET NOT NULL,
    ADD CONSTRAINT log_policies_retention_days_check CHECK (retention_days > 0),
    DROP COLUMN hot_days,
    DROP COLUMN cold_days,
    DROP COLUMN sampling_rate;

-- 기존 레이어 3개(WAS/Falco/K8s Audit, 소스별 구분)를 지우고 3등급 체계로
-- 재시드한다 - layer가 PK라 자연키 자체가 바뀌는 이상 UPDATE로 이름만 바꾸는
-- 것보다 삭제 후 재시드가 명확하다.
DELETE FROM log_policies;

INSERT INTO log_policies (layer, retention_days, archive_enabled) VALUES
    ('기록', 365, true),
    ('원본', 30, true),
    ('파생', 14, true);
