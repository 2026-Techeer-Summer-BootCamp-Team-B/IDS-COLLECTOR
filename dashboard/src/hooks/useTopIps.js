import { useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";

// GET /stats/top-ips (servers/platform-api/app/stats_api.py) — mockLogs.js의
// topSourcesFor를 대체. 실제 벽시계 시각 기준으로 start/end(ISO8601)를 계산해서
// 보낸다 — mock 데이터의 고정된 MOCK_NOW와 달리 실제 API는 "진짜 지금"을 써야
// 최근 데이터가 잡힌다. apiFetch가 Authorization 헤더를 자동으로 붙인다.
export function useTopIps({ lookbackMs, limit = 10 }) {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);

    const end = new Date();
    const start = new Date(end.getTime() - lookbackMs);
    const qs = new URLSearchParams({
      start: start.toISOString(),
      end: end.toISOString(),
      limit: String(limit),
    });

    apiGet(`/stats/top-ips?${qs.toString()}`)
      .then((data) => {
        if (cancelled) return;
        const mapped = (data?.items ?? []).map((it) => ({ name: it.source_ip, count: it.count }));
        setItems(mapped);
        setStatus("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        setItems([]);
        setError(e instanceof ApiError ? e.message : "Top IPs를 불러오지 못했습니다.");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [lookbackMs, limit]);

  return { items, status, error };
}
