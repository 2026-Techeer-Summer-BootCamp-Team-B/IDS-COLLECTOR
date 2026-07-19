-- correlation_key_type enum에 'rule.id' 값 추가 (2026-07-20, Notion "여러 계층
-- 시나리오" M32 - S90 재료).
--
-- 지금까지의 enum(source.ip/user.name/orchestrator.resource.name)은 전부
-- "발신지/신원/대상 리소스" 축이다 - S90은 "공격 시그니처(rule_id)"를 join_on으로
-- 쓰는 이 카탈로그 최초의 시나리오라(correlation-engine의 app/rules.py
-- _join_key()에 rule_id 케이스를 함께 추가함), Incident.correlation_key_type에
-- 저장할 새 enum 값이 필요하다.
ALTER TYPE correlation_key_type ADD VALUE IF NOT EXISTS 'rule.id';
