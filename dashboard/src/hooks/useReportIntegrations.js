import { useCallback, useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";

// GET /report-notifications/connections (servers/platform-api/app/report_notifications_api.py) —
// 로그인한 사용자 본인의 Slack/Discord 연동 목록. app/report_notification_service.py가
// enabled=true인 행을 스케줄 리포트 발송 대상으로 삼는다.
export function useReportIntegrations() {
  const [connections, setConnections] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setStatus((s) => (s === "ready" ? "ready" : "loading"));
    apiGet("/report-notifications/connections")
      .then((res) => {
        if (cancelled) return;
        setConnections(res ?? []);
        setStatus("ready");
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : "연동 정보를 불러오지 못했습니다.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return { connections, status, error, reload };
}
