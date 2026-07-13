import { useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";

// GET /reports/trend (servers/platform-api/app/main.py -> app/ai_report.py) — 최근
// N일 인시던트를 scenario별로 집계하고, ANTHROPIC_API_KEY가 설정돼 있으면 그걸
// Claude로 요약할 계획인 엔드포인트. 지금은 실제 프롬프트 호출부가 TODO라
// {configured, message, stats} 중 stats(원본 집계)만 항상 채워지고, message는
// "미설정" 또는 "TODO: Anthropic API 호출 구현 필요" 둘 중 하나가 온다 — 백엔드가
// 구현되면 프론트는 손댈 필요 없이 message 자리에 실제 요약문이 그대로 나온다.
export function useTrendReport({ days = 7 } = {}) {
  const [report, setReport] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    apiGet(`/reports/trend?days=${days}`)
      .then((res) => {
        if (cancelled) return;
        setReport(res);
        setStatus("ready");
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setReport(null);
        setError(e instanceof ApiError ? e.message : "트렌드 리포트를 불러오지 못했습니다.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  return { report, status, error };
}
