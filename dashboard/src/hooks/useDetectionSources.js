import { useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";

// GET /stats?start=&end= (servers/platform-api/app/stats_api.py)의 by_module을
// 재사용 — "탐지 소스별 분포" 도넛의 실데이터 소스. WAF는 비활성화 상태라
// by_module에 안 잡히거나 0건일 수 있음(정상 — backend/ 매니페스트가 주석 처리됨).
export function useDetectionSources({ lookbackMs }) {
  const [byModule, setByModule] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);

    const end = new Date();
    const start = new Date(end.getTime() - lookbackMs);
    const qs = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });

    apiGet(`/stats?${qs.toString()}`)
      .then((res) => {
        if (cancelled) return;
        setByModule(res.by_module ?? []);
        setStatus("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        setByModule([]);
        setError(e instanceof ApiError ? e.message : "소스별 분포를 불러오지 못했습니다.");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [lookbackMs]);

  return { byModule, status, error };
}
