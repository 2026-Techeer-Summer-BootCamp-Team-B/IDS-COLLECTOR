import { useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";

// GET /reports/trend (servers/platform-api/app/main.py -> app/ai_report.py) — 최근
// N일 인시던트를 scenario별로 집계하고, GEMINI_API_KEY가 설정돼 있으면 그걸 Gemini로
// 요약해서 돌려주는 엔드포인트. {configured, message, stats} 중 stats는 항상
// 원본 집계이고, message는 미설정 안내문 또는 실제 AI 요약문이 그대로 온다.
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
