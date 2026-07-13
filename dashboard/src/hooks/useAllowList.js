import { useCallback, useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";

// GET /allow-list (servers/platform-api/app/allow_list_api.py) — 탐지 예외
// IP/CIDR 목록. target_id가 있으면 그 타깃에만, 없으면 전역 예외. 등록해도
// correlation-engine/normalizer가 아직 이 테이블을 읽고 걸러내는 로직은 없다
// (banned_ips와 같은 성격의 "장부용" 테이블 — allow_list_api.py 주석 참고).
export function useAllowList() {
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setStatus((s) => (s === "ready" ? "ready" : "loading"));
    apiGet("/allow-list")
      .then((res) => {
        if (cancelled) return;
        setEntries(res ?? []);
        setStatus("ready");
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : "허용 목록을 불러오지 못했습니다.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return { entries, status, error, reload };
}
