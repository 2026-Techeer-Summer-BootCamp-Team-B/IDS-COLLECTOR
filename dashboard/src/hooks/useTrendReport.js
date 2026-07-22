import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, ApiError } from "../lib/authApi";

// GET /reports/trend (servers/platform-api/app/main.py -> app/ai_report.py) — 최근
// N일 인시던트를 scenario별로 집계하고, GEMINI_API_KEY가 설정돼 있으면 그걸 Gemini로
// 요약해서 돌려주는 엔드포인트. {configured, message, stats} 중 stats는 항상
// 원본 집계이고, message는 미설정 안내문 또는 실제 AI 요약문이 그대로 온다.
export function useTrendReport({ days = 7 } = {}) {
  const [report, setReport] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(() => {
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

  useEffect(() => load(), [load]);

  // POST /reports/trend/generate — GET /reports/trend와 달리 캐시만 읽지 않고
  // Gemini를 실제로 (필요시) 호출해서 지금 즉시 리포트를 새로 만든다. notify
  // 엔드포인트와 달리 webhook 알림은 보내지 않는다(app/main.py 참고).
  const generateNow = useCallback(async () => {
    setGenerating(true);
    try {
      const res = await apiPost("/reports/trend/generate", { days });
      setReport(res);
      setStatus("ready");
      setError(null);
      return res;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "리포트 생성에 실패했습니다.");
      throw e;
    } finally {
      setGenerating(false);
    }
  }, [days]);

  return { report, status, error, generating, generateNow };
}
