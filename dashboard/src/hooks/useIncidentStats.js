import { useCallback, useEffect, useState } from "react";
import { apiGet, fetchIncidentSummary } from "../lib/authApi";

const EMPTY = { total: 0, by_status: {}, by_severity: {} };

// TopBar의 전역 수치와 IncidentsView의 집계 데이터는 목록 페이지와 분리해
// 서버 집계로 받는다. 목록이 수천 건이어도 전체 행을 내려받지 않는다.
export function useIncidentStats() {
  const [summary, setSummary] = useState(EMPTY);
  const [stats, setStats] = useState({ activeIncidents: 0, totalDetected: 0, openAlerts: 0, totalBlocked: 0 });
  const [status, setStatus] = useState("loading");

  const reload = useCallback(() => Promise.all([fetchIncidentSummary(), apiGet("/banned-ips")])
    .then(([nextSummary, bannedIps]) => {
      const byStatus = nextSummary.by_status ?? {};
      const open = byStatus.open ?? 0;
      setSummary(nextSummary);
      setStats({
        activeIncidents: open + (byStatus.investigating ?? 0),
        totalDetected: nextSummary.total ?? 0,
        openAlerts: open,
        totalBlocked: (bannedIps ?? []).length,
      });
      setStatus("ready");
      return nextSummary;
    })
    .catch((error) => {
      setStatus("error");
      throw error;
    }), []);

  useEffect(() => {
    reload().catch(() => {});
  }, [reload]);

  return { stats, summary, status, reload };
}
