import { useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";
import { usePoll } from "./usePoll";

// GET /stats/volume (servers/platform-api/app/stats_api.py) — Log Volume 차트의
// 실데이터 소스. bucketMs로부터 서버에 보낼 hours/buckets 개수를 역산해서 요청하고,
// 응답의 { ts, total, errors } 배열을 그대로 반환한다 — 라벨 포맷(timeSeries.js의
// formatBucketLabel)과 급증 탐지(detectSpike)는 프론트에서 그대로 재사용. pollMs를
// 주면 주기적으로 재요청.
export function useLogVolume({ lookbackMs, bucketMs, module, pollMs }) {
  const [buckets, setBuckets] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const pollTick = usePoll(pollMs);

  useEffect(() => {
    let cancelled = false;
    setStatus((s) => (s === "ready" ? "ready" : "loading"));
    setError(null);

    const hours = Math.max(lookbackMs / (60 * 60 * 1000), 1 / 60);
    const bucketCount = Math.max(Math.round(lookbackMs / bucketMs), 1);
    const qs = new URLSearchParams({ hours: String(hours), buckets: String(bucketCount) });
    if (module) qs.set("module", module);

    apiGet(`/stats/volume?${qs.toString()}`)
      .then((res) => {
        if (cancelled) return;
        setBuckets(res.buckets ?? []);
        setStatus("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        setBuckets([]);
        setError(e instanceof ApiError ? e.message : "Log Volume을 불러오지 못했습니다.");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [lookbackMs, bucketMs, module, pollTick]);

  return { buckets, status, error };
}
