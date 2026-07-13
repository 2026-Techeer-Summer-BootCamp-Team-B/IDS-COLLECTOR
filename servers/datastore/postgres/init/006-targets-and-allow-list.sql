-- targets/allow_list를 실제로 API가 쓰기 시작하면서 발견한 기존 스키마 버그 하나부터
-- 고친다: attack_type enum이 'audit'인데 NormalizedEvent.event_module
-- (servers/shared/ids_shared/schemas.py)의 실제 값은 'k8s_audit'다. detection_rules가
-- (스키마만 있고 지금도 완전 미사용 - 단일 이벤트 판정은 WAF/Falco 자체 룰 엔진 +
-- normalizer/app/severity.yaml로 이미 커버되고 있어서 별도 구현 안 하기로 함) 이
-- enum을 유일하게 쓰는 컬럼이라 지금 당장 영향은 없지만, 정의 자체는 바로잡아둔다.
ALTER TYPE attack_type RENAME VALUE 'audit' TO 'k8s_audit';

-- targets/allow_list CRUD가 감사 로그에 남길 행위 종류 추가.
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'TARGET_CREATED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'TARGET_UPDATED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'TARGET_DELETED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'ALLOW_LIST_CREATED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'ALLOW_LIST_DELETED';
