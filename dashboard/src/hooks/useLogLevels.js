import { useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";
import { usePoll } from "./usePoll";

// GET /stats/levels (servers/platform-api/app/stats_api.py) — Log Levels 차트의
// 실데이터 소스 (event.severity 1~4, realSeverity.js와 짝). pollMs를 주면 주기적으로
// 재요청.
export function useLogLevels({ hours, module, pollMs }) {
  const [levels, setLevels] = useState([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const pollTick = usePoll(pollMs);

  useEffect(() => {
    let cancelled = false;
    setStatus((s) => (s === "ready" ? "ready" : "loading"));
    setError(null);

    const qs = new URLSearchParams({ hours: String(hours) });
    if (module) qs.set("module", module);

    apiGet(`/stats/levels?${qs.toString()}`)
      .then((res) => {
        if (cancelled) return;
        setLevels(res.levels ?? []);
        setTotal(res.total ?? 0);
        setStatus("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        setLevels([]);
        setTotal(0);
        setError(e instanceof ApiError ? e.message : "Log Levels를 불러오지 못했습니다.");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [hours, module, pollTick]);

  return { levels, total, status, error };
}
