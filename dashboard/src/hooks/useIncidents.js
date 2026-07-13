import { useCallback, useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";

// GET /incidents (servers/platform-api/app/incidents_api.py) — IncidentsView의
// 실데이터 소스, data/incidents.js의 mock incidents 배열을 대체. status 필터는
// 안 걸고(limit만 넉넉히) 한 번에 받아와 클라이언트에서 상태별로 좁힌다 — 목록
// 하나로 KPI 카운트/도넛/카드 리스트를 전부 파생시키는 게 서버 요청 여러 번보다
// 간단하고, 이 프로젝트 규모(500 cap)에서는 부담도 없다.
export function useIncidents({ limit = 200 } = {}) {
  const [incidents, setIncidents] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    // 리로드(재조회)일 땐 이미 ready 상태를 유지해서 목록이 깜빡이지 않게 한다 —
    // 최초 로드일 때만 loading 문구를 보여준다.
    setStatus((s) => (s === "ready" ? "ready" : "loading"));

    apiGet(`/incidents?limit=${limit}`)
      .then((res) => {
        if (cancelled) return;
        setIncidents(res ?? []);
        setStatus("ready");
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : "인시던트 목록을 불러오지 못했습니다.");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [limit, reloadToken]);

  return { incidents, status, error, reload };
}
