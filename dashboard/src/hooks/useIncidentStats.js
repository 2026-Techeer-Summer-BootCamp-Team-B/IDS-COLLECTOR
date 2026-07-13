import { useEffect, useState } from "react";
import { apiGet } from "../lib/authApi";

// TopBar 상단 4개 스탯(진행중 INCIDENT / 총 DETECTED / 오픈 ALERT / 총 BLOCKED) +
// 사이드바 Incidents 뱃지 실데이터 소스 — data/incidents.js의 mock incidentStats를
// 대체. TopBar가 모든 화면에 상시 노출이라 AppShell에서 한 번만 불러와 내려쓴다.
export function useIncidentStats() {
  const [stats, setStats] = useState({ activeIncidents: 0, totalDetected: 0, openAlerts: 0, totalBlocked: 0 });
  const [status, setStatus] = useState("loading"); // loading | ready | error

  useEffect(() => {
    let cancelled = false;
    Promise.all([apiGet("/incidents?limit=500"), apiGet("/banned-ips")])
      .then(([incidents, bannedIps]) => {
        if (cancelled) return;
        const list = incidents ?? [];
        const open = list.filter((i) => i.status === "open").length;
        const investigating = list.filter((i) => i.status === "investigating").length;
        setStats({
          activeIncidents: open + investigating,
          totalDetected: list.length,
          openAlerts: open,
          totalBlocked: (bannedIps ?? []).length,
        });
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { stats, status };
}
