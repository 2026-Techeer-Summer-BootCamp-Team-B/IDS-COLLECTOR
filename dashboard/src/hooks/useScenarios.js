import { useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";

// GET /scenarios (servers/platform-api/app/scenarios_api.py) — 상관 시나리오
// 룰 + 적중(hit_count) 랭킹. IncidentsView의 "Top 상관 규칙"과 상세 패널의
// "상관 규칙" 이름 조회(matched_scenario_rule_id -> name)에 쓴다.
export function useScenarios() {
  const [scenarios, setScenarios] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    apiGet("/scenarios")
      .then((res) => {
        if (cancelled) return;
        setScenarios(res ?? []);
        setStatus("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : "상관 규칙을 불러오지 못했습니다.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { scenarios, status, error };
}
