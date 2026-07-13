import { useCallback, useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";

// GET /alert-configs (servers/platform-api/app/alert_configs_api.py) — Slack/Discord
// 웹훅 알림 설정 목록. app/notifications.py가 이 테이블을 실제로 읽어서 발송하므로
// (targets/allow-list 같은 "장부용" 테이블과 달리) 여기서 만든 설정은 바로 동작한다 —
// CRITICAL 인시던트가 생기면 이 목록의 활성 채널로 실제 알림이 나간다.
export function useAlertConfigs() {
  const [configs, setConfigs] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setStatus((s) => (s === "ready" ? "ready" : "loading"));
    apiGet("/alert-configs")
      .then((res) => {
        if (cancelled) return;
        setConfigs(res ?? []);
        setStatus("ready");
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : "알림 설정을 불러오지 못했습니다.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return { configs, status, error, reload };
}
