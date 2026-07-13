import { useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";

// GET /incidents/{id}/timeline (servers/platform-api/app/incidents_api.py) —
// 선택된 인시던트의 공격 스토리라인. incidentId가 바뀔 때만 다시 불러온다.
export function useIncidentTimeline(incidentId) {
  const [timeline, setTimeline] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | loading | ready | error
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!incidentId) {
      setTimeline([]);
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setError(null);

    apiGet(`/incidents/${incidentId}/timeline`)
      .then((res) => {
        if (cancelled) return;
        setTimeline(res ?? []);
        setStatus("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        setTimeline([]);
        setError(e instanceof ApiError ? e.message : "타임라인을 불러오지 못했습니다.");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [incidentId]);

  return { timeline, status, error };
}
