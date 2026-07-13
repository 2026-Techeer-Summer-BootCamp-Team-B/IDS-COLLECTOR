import { useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";

// GET /attck/coverage/{technique_id}/incidents (attck_api.py) — 선택한 기법에
// matched_scenario_rule_id로 연결된 incidents 목록. mock의 matchedLogsByTechnique와
// 달리 "개별 로그"가 아니라 IncidentsView와 동일한 IncidentOut(집계된 인시던트) 단위다.
// technique_id가 바뀔 때마다 다시 불러온다.
export function useTechniqueIncidents(techniqueId) {
  const [incidents, setIncidents] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!techniqueId) {
      setIncidents([]);
      setStatus("ready");
      setError(null);
      return;
    }
    let cancelled = false;
    setStatus("loading");
    apiGet(`/attck/coverage/${encodeURIComponent(techniqueId)}/incidents`)
      .then((res) => {
        if (cancelled) return;
        setIncidents(res ?? []);
        setStatus("ready");
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : "해당 기법의 인시던트를 불러오지 못했습니다.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [techniqueId]);

  return { incidents, status, error };
}
