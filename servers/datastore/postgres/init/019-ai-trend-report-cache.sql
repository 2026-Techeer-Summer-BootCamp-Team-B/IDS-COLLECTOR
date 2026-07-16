-- AI 트렌드 리포트(app/ai_report.py) 캐시 - 같은 days 창에서 시나리오별 집계
-- (stats)가 지난 호출과 완전히 동일하면 Gemini를 다시 호출하지 않고 이전 요약을
-- 그대로 재사용한다. stats_hash가 바뀌지 않았다는 건 그 사이 새 인시던트가
-- 안 생겼거나 집계 결과가 우연히 같다는 뜻이라 - 어느 쪽이든 다시 요약할 이유가
-- 없다(같은 입력 -> 같은 결론, 토큰 낭비만 됨).
--
-- days를 PK로 쓴다 - 지금은 프론트가 항상 7만 호출하지만(AdminAuditView.jsx
-- useTrendReport({days: 7})) API 자체는 임의의 days를 받으므로 창 크기별로
-- 캐시를 분리해야 한다.
CREATE TABLE IF NOT EXISTS ai_trend_report_cache (
    days         INTEGER PRIMARY KEY,
    stats_hash   TEXT NOT NULL,
    message      TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
