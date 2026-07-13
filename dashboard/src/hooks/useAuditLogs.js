import { useCallback, useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";

// GET /audit-logs (servers/platform-api/app/audit_logs_api.py) — Admin/Audit
// 탭의 "Audit Log" 테이블 실데이터 소스. App.jsx의 mock SEED_AUDIT_LOG(+ logAction
// 으로 쌓던 로컬 전용 로그)를 대체한다.
//
// 주의: 백엔드엔 아직 "유저 목록" 조회 API가 없어서(users 테이블 CRUD 라우터 없음)
// 이 훅은 user_id를 UUID 그대로 돌려준다 — 화면에서 사람이 읽을 이름으로 바꾸려면
// 백엔드에 /users(또는 세션에 저장된 로그인 유저 목록) 조회 API가 먼저 필요하다.
// 지금은 null이면 "system"(로그인 없이 서버가 자체적으로 남긴 행)으로만 구분한다.
export function useAuditLogs({ limit = 50 } = {}) {
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setStatus((s) => (s === "ready" ? "ready" : "loading"));

    apiGet(`/audit-logs?limit=${limit}`)
      .then((res) => {
        if (cancelled) return;
        setLogs(res ?? []);
        setStatus("ready");
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : "감사 로그를 불러오지 못했습니다.");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [limit, reloadToken]);

  return { logs, status, error, reload };
}
