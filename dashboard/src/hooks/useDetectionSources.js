import { useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";
import { usePoll } from "./usePoll";

// GET /stats?start=&end= (servers/platform-api/app/stats_api.py)의 by_module을
// 재사용 — "탐지 소스별 분포" 도넛과 WAS/Falco/K8sAudit 상세 뷰의 "Total" 카드
// 실데이터 소스. WAF는 비활성화 상태라 by_module에 안 잡히거나 0건일 수 있음
// (정상 — backend/ 매니페스트가 주석 처리됨). pollMs를 주면 주기적으로 재요청.
export function useDetectionSources({ lookbackMs, pollMs }) {
  const [byModule, setByModule] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const pollTick = usePoll(pollMs);

  useEffect(() => {
    let cancelled = false;
    setStatus((s) => (s === "ready" ? "ready" : "loading"));
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
  }, [lookbackMs, pollTick]);

  return { byModule, status, error };
}
