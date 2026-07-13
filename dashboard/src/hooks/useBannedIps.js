import { useCallback, useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";

// GET /banned-ips (servers/platform-api/app/banned_ips_api.py) — 현재 활성
// 차단 IP 목록(감사 트레일용, 실제 트래픽을 막진 않음 - 백엔드 주석 참고).
// IncidentsView의 "차단된 IP" 테이블 + 인시던트 상세의 "이미 차단됐는지" 체크에 씀.
export function useBannedIps() {
  const [bannedIps, setBannedIps] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setStatus((s) => (s === "ready" ? "ready" : "loading"));
    apiGet("/banned-ips")
      .then((res) => {
        if (cancelled) return;
        setBannedIps(res ?? []);
        setStatus("ready");
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : "차단 IP 목록을 불러오지 못했습니다.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return { bannedIps, status, error, reload };
}
