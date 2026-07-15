-- 제외 규칙(exclusion_rules, 저가치 노이즈 자동 드롭) 기능 제거 (2026-07-15).
-- EX-01("Contact K8S API Server From Container" 룰 이름만으로 매치)/EX-02(모든
-- system:serviceaccount:* 신원의 get/watch를 매치) 둘 다 조건이 너무 거칠어서,
-- correlation-engine의 실제 탐지 시나리오가 봐야 할 이벤트까지 같이 드롭하는 게
-- 확인됐다:
--   - S1(Pod Exec 권한 사용 이후 컨테이너 내 이상행동, severity 4, T1609)과
--     S5(WAF CRITICAL 차단 이후 실제 컨테이너 침투 확인, severity 4, T1190) 둘 다
--     stage2에서 정확히 EX-01이 지우는 그 Falco 룰 이름을 트리거 조건으로 쓴다
--     (correlation-engine/app/scenarios/workload.yaml, network.yaml).
--   - S10(get/list/watch 대량 호출 정찰 탐지, T1613)이 잡아야 할 가장 현실적인
--     케이스(탈취된 서비스어카운트로 정찰)를 EX-02가 "routine reconcile"로 오판해서
--     정확히 가려버린다.
-- IDS에서는 로그 volume 절감보다 탐지 누락이 훨씬 위험하다고 판단해 기능 자체를
-- 뺐다(정교하게 좁힌 조건으로 다시 필요해지면 재도입 검토).
--
-- normalizer/app/exclusion.py・db.py 삭제, app/main.py의 _exclusion_refresh_loop
-- 제거, platform-api의 app/data_policy_api.py router_exclusion_rules 제거와 함께
-- 진행 - 이 마이그레이션은 그 코드 제거에 대응하는 스키마 정리다.
DROP TABLE IF EXISTS exclusion_rules;

DELETE FROM poll_intervals WHERE key = 'exclusion_rules_refresh_seconds';

-- audit_action enum의 'EXCLUSION_RULE_TOGGLED' 값은 Postgres에서 enum 값을 안전하게
-- 제거하는 절차가 무겁고(타입 재생성 필요) 이미 쌓인 audit_logs 행의 값을 깨뜨릴
-- 위험이 있어 그대로 둔다 - 이제 아무도 이 값으로 INSERT하지 않을 뿐, 존재 자체는
-- 무해하다.
