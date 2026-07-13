-- detection_rules는 처음부터 스키마만 있고 이걸 평가하는 서비스가 없었다(001-schema.sql
-- 주석 참고). 팀 API 설계 시트에도 "Rules API - 시그니처 코드 관리로 대체, 폐기"로 이미
-- 결정돼 있고, 단일 이벤트 시그니처 판정은 WAF/Falco 자체 룰 엔진 + normalizer/severity.yaml로
-- 커버되고 있어 필요 없어졌다. 코드 전체에서 detection_rules를 참조하는 곳이 없음을
-- grep으로 확인 후 드롭한다.
--
-- attack_type/detection_severity 두 enum은 detection_rules 컬럼에서만 쓰였으므로 테이블과
-- 함께 정리한다(audit_action의 RULE_ENABLED/RULE_DISABLED는 scenario_rules 토글에 여전히
-- 쓰이고 있어 건드리지 않는다 - RULE_CREATED만 이제 미사용이지만 enum 값 하나 제거는
-- Postgres에서 타입 재생성이 필요한 위험한 작업이라 그대로 둔다).
DROP TABLE IF EXISTS detection_rules;
DROP TYPE IF EXISTS detection_severity;
DROP TYPE IF EXISTS attack_type;
