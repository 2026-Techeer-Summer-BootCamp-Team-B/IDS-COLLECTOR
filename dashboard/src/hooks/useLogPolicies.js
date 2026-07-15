import { useCallback, useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";

// GET /log-policies (servers/platform-api/app/data_policy_api.py) — 계층별(WAS/Falco/
// K8s Audit) 로그 보존(hot/cold tier)·샘플링 정책. AdminAuditView의 "데이터 정책"
// 패널이 PATCH /log-policies/{layer}로 값을 바꾼 뒤 reload()로 다시 받아온다.
export function useLogPolicies() {
  const [policies, setPolicies] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setStatus((s) => (s === "ready" ? "ready" : "loading"));
    apiGet("/log-policies")
      .then((res) => {
        if (cancelled) return;
        setPolicies(res ?? []);
        setStatus("ready");
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : "데이터 정책을 불러오지 못했습니다.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return { policies, status, error, reload };
}
