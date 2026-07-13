import { useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";

// GET /attck/coverage (servers/platform-api/app/attck_api.py) — data/attackMatrix.js의
// mock tactics/totalTechniques/detectedTechniques를 대체. ids_shared.mitre_mapping의
// 전체 Containers 매트릭스 카탈로그를 뼈대로, incidents를 matched_scenario_rule_id로
// 집계한 기법별 hit count를 채운 응답이라 - 카탈로그엔 있지만 hit이 0인 기법도
// 그대로 포함된다("이론상 잡을 수 있는 기법 중 실제로 몇 %를 봤는가"). 응답 모양이
// {tactics:[{name, techniques:[{id,name,hits}]}], total_techniques, detected_techniques}
// 라서 AttackMatrixView가 쓰던 mock 구조와 거의 1:1로 맞는다.
export function useAttackCoverage() {
  const [tactics, setTactics] = useState([]);
  const [totalTechniques, setTotalTechniques] = useState(0);
  const [detectedTechniques, setDetectedTechniques] = useState(0);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    apiGet("/attck/coverage")
      .then((res) => {
        if (cancelled) return;
        setTactics(res?.tactics ?? []);
        setTotalTechniques(res?.total_techniques ?? 0);
        setDetectedTechniques(res?.detected_techniques ?? 0);
        setStatus("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : "ATT&CK 커버리지를 불러오지 못했습니다.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { tactics, totalTechniques, detectedTechniques, status, error };
}
