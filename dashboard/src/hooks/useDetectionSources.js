import { useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";
import { usePoll } from "./usePoll";

// GET /stats?start=&end= (servers/platform-api/app/stats_api.py)의 by_module을
// 재사용 — "탐지 소스별 분포" 도넛과 WAS/WAF/Falco/K8sAudit 상세 뷰의 "Total"
// 카드 실데이터 소스. WAF는 2026-07-16부터 백엔드가 다시 붙어서 by_module에도
// 정상적으로 잡힌다. pollMs를 주면 주기적으로 재요청. minSeverity(">=")/
// severity(정확히 일치)는 Overview KPI 카드(Errors/Warnings) 클릭 필터 -
// 2026-07-17 추가.
export function useDetectionSources({ lookbackMs, minSeverity, severity, pollMs }) {
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
    if (minSeverity != null) qs.set("min_severity", String(minSeverity));
    if (severity != null) qs.set("severity", String(severity));

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
  }, [lookbackMs, minSeverity, severity, pollTick]);

  return { byModule, status, error };
}
