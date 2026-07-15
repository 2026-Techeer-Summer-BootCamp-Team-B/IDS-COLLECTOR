import { useCallback, useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";
import { getModuleMeta } from "../data/moduleMeta";

// GET /stats/source-health (servers/platform-api/app/stats_api.py) — 소스별
// 최신 attack-logs-* 수신 시각 기반 무응답 판정. InfrastructureView.jsx의
// SourceHealthPanel이 예전엔 data/attackEvents.js의 sourceHealth()(고정 mock
// 날짜라 항상 같은 값)를 썼다 - 그 자리를 대체한다. 응답의 module(was/falco/
// k8s_audit)을 getModuleMeta로 사람이 읽는 라벨(WAS/Falco/K8s Audit)로 바꾸고,
// silent_seconds(초)를 SourceHealthPanel의 formatSilence가 기대하는 ms로 바꾼다.
export function useSourceHealth() {
  const [health, setHealth] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setStatus((s) => (s === "ready" ? "ready" : "loading"));

    apiGet("/stats/source-health")
      .then((res) => {
        if (cancelled) return;
        const mapped = (res ?? []).map((row) => ({
          source: getModuleMeta(row.module).label,
          silentMs: row.silent_seconds === null ? Infinity : row.silent_seconds * 1000,
          status: row.status,
        }));
        setHealth(mapped);
        setStatus("ready");
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : "소스 헬스체크를 불러오지 못했습니다.");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return { health, status, error, reload };
}
