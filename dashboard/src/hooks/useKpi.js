import { useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";
import { usePoll } from "./usePoll";

// GET /stats/kpi (servers/platform-api/app/stats_api.py) — Overview 상단 KPI
// 카드 4개(Total/Errors/Warnings/Active Sources)의 실데이터 소스. mockLogs.js
// 기반 rangeEvents 집계를 대체. pollMs를 주면 주기적으로 재요청.
export function useKpi({ hours, pollMs }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const pollTick = usePoll(pollMs);

  useEffect(() => {
    let cancelled = false;
    setStatus((s) => (s === "ready" ? "ready" : "loading"));
    setError(null);

    apiGet(`/stats/kpi?hours=${hours}`)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setStatus("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        setData(null);
        setError(e instanceof ApiError ? e.message : "KPI를 불러오지 못했습니다.");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [hours, pollTick]);

  return { data, status, error };
}
