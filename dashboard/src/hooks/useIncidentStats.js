import { useEffect, useState } from "react";
import { apiGet } from "../lib/authApi";

// TopBar 상단 4개 스탯(진행중 INCIDENT / 총 DETECTED / 오픈 ALERT / 총 BLOCKED) +
// 사이드바 Incidents 뱃지 실데이터 소스 — data/incidents.js의 mock incidentStats를
// 대체. TopBar가 모든 화면에 상시 노출이라 AppShell에서 한 번만 불러와 내려쓴다.
//
// GET /incidents/stats(Postgres GROUP BY 집계, servers/platform-api/app/
// incidents_api.py)를 쓴다 - 예전엔 apiGetAllPages로 /incidents 전체를 커서
// 페이지네이션해서 받아온 뒤 여기서 세었는데(2026-07-23, "Total이 500개로
// 캡되던" 버그 수정 당시 도입), 더미 생성기가 계속 발화하면서 인시던트가
// 수천 건으로 늘자 그 전체 fetch 자체가 몇 초씩 걸리게 됐다(2026-07-24, "인시던트
// 창 그래프가 느리다" 피드백으로 실측 확인). TopBar는 개수만 필요하므로 서버
// GROUP BY 집계 하나로 대체 - 실제 인시던트 행이 필요 없는 화면이라 딱 맞는다.
export function useIncidentStats() {
  const [stats, setStats] = useState({ activeIncidents: 0, totalDetected: 0, openAlerts: 0, totalBlocked: 0 });
  const [status, setStatus] = useState("loading"); // loading | ready | error

  useEffect(() => {
    let cancelled = false;
    Promise.all([apiGet("/incidents/stats"), apiGet("/banned-ips")])
      .then(([incidentStats, bannedIps]) => {
        if (cancelled) return;
        const byStatus = Object.fromEntries((incidentStats?.by_status ?? []).map((s) => [s.status, s.count]));
        const open = byStatus.open ?? 0;
        const investigating = byStatus.investigating ?? 0;
        setStats({
          activeIncidents: open + investigating,
          totalDetected: incidentStats?.total ?? 0,
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
