import { useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";

// GET /incidents/stats (servers/platform-api/app/incidents_api.py, Postgres
// GROUP BY 집계) — IncidentsView의 KPI 행(Open/Investigating/Resolved/Total)과
// "심각도 분포"/"상태별 분포" 도넛 실데이터 소스. useIncidents()가 받아오는 전체
// 인시던트 배열에서 세던 방식(2026-07-24 이전)이 인시던트가 수천 건으로 늘면서
// 느려져서(카드 목록/그룹핑용 전체 fetch와 별개로) 개수만 필요한 이 세 위젯은
// 서버 집계 하나로 분리했다 - useIncidentStats.js(TopBar)와 같은 이유·같은
// 엔드포인트, 이쪽은 Incidents 화면 안에서만 쓰는 별도 훅.
export function useIncidentCounts() {
  const [total, setTotal] = useState(0);
  const [byStatus, setByStatus] = useState({});
  const [bySeverity, setBySeverity] = useState({});
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = () => setReloadToken((t) => t + 1);

  useEffect(() => {
    let cancelled = false;
    setStatus((s) => (s === "ready" ? "ready" : "loading"));

    apiGet("/incidents/stats")
      .then((res) => {
        if (cancelled) return;
        setTotal(res?.total ?? 0);
        setByStatus(Object.fromEntries((res?.by_status ?? []).map((s) => [s.status, s.count])));
        setBySeverity(Object.fromEntries((res?.by_severity ?? []).map((s) => [s.severity, s.count])));
        setStatus("ready");
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : "인시던트 통계를 불러오지 못했습니다.");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return { total, byStatus, bySeverity, status, error, reload };
}
