import { useCallback, useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";

// GET /targets (servers/platform-api/app/targets_api.py) — 보호 대상 애플리케이션
// 등록 목록(예: "Juice Shop #1", "Juice Shop #2"). 등록해도 파이프라인이 아직 이
// 테이블을 읽지 않는다(normalizer가 Postgres 연결이 없어서 별도 작업) — 지금은
// 순수 등록/관리용 장부. AllowListPanel의 target 드롭다운도 이 훅을 같이 쓴다.
export function useTargets() {
  const [targets, setTargets] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setStatus((s) => (s === "ready" ? "ready" : "loading"));
    apiGet("/targets")
      .then((res) => {
        if (cancelled) return;
        setTargets(res ?? []);
        setStatus("ready");
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : "타깃 목록을 불러오지 못했습니다.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return { targets, status, error, reload };
}
