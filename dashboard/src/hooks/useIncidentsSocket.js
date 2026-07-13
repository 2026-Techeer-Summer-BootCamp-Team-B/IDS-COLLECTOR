import { useEffect, useRef } from "react";

// 2026-07-13부로 백엔드가 /ws/incidents(WebSocket)를 완전히 제거하고 GET
// /incidents?since=<ISO8601> 짧은 주기 폴링 방식으로 바꿨다(servers/platform-api/
// app/incident_alerts.py, app/incidents_api.py 참고 — platform-api 재시작/단절 중
// 발화된 인시던트가 Redis pub/sub 특성상 영구 유실되는 문제를 없애려고 바뀜).
// 프론트도 맞춰서 WebSocket 대신 setInterval 폴링으로 전환 - 훅 이름/시그니처
// (콜백 하나 받아서 새 데이터가 있을 때 호출)는 그대로 유지해서 IncidentsView.jsx는
// 손댈 필요 없게 했다. 실제 재조회는 콜백으로 넘어온 useIncidents().reload가
// GET /incidents(전체 목록)를 다시 받아오는 방식이라 since 파라미터 자체는 아직
// 여기서 안 쓴다 - CRITICAL 팝업처럼 "새로 생긴 것만" 구분해야 하는 기능이 생기면
// 그때 fetchIncidentsSince(dashboard/src/lib/authApi.js)로 바꾸면 된다.
const POLL_INTERVAL_MS = 5000;

export function useIncidentsSocket(onUpdate) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    const timer = setInterval(() => {
      onUpdateRef.current?.();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);
}
