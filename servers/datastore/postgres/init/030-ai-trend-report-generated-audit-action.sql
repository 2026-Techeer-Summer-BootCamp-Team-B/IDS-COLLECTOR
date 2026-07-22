-- 026과 같은 패턴/원인: app/main.py의 POST /reports/trend/generate(대시보드
-- "리포트 생성" 버튼용 신규 엔드포인트)가 record_action()에
-- 'AI_TREND_REPORT_GENERATED'를 넘기는데, audit_action enum에 이 값이 없어서
-- "invalid input value for enum audit_action" 500이 났다(실측 확인,
-- 2026-07-22 - Gemini 호출/캐시 저장까지는 성공하지만 그 뒤 감사로그 기록에서
-- 터져 응답 자체를 못 받음). 003/006/025/026과 같은 패턴으로 누락된 값만 추가.
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'AI_TREND_REPORT_GENERATED';
