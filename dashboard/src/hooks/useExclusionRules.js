import { useCallback, useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";

// GET /exclusion-rules (servers/platform-api/app/data_policy_api.py) — 파이프라인
// 단계에서 걸러낼 저가치 노이즈 패턴 4개(EX-01~04). AdminAuditView의 "데이터 정책"
// 패널이 PATCH /exclusion-rules/{id}/enabled로 on/off한 뒤 reload()로 다시 받아온다.
export function useExclusionRules() {
  const [rules, setRules] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setStatus((s) => (s === "ready" ? "ready" : "loading"));
    apiGet("/exclusion-rules")
      .then((res) => {
        if (cancelled) return;
        setRules(res ?? []);
        setStatus("ready");
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : "제외 규칙을 불러오지 못했습니다.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return { rules, status, error, reload };
}
