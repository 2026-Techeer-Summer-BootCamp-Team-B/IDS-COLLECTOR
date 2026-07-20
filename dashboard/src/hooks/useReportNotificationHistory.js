import { useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";

// GET /report-notifications/history (servers/platform-api/app/report_notifications_api.py) —
// 스케줄 리포트가 Slack/Discord로 발송될 때마다(app/report_notification_service.py) 남는
// 최근 전송 내역. 연동이 해제돼도 이력 자체는 남는다(024 마이그레이션, connection_id는
// ON DELETE SET NULL).
export function useReportNotificationHistory({ limit = 20 } = {}) {
  const [history, setHistory] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = () => setReloadToken((t) => t + 1);

  useEffect(() => {
    let cancelled = false;
    setStatus((s) => (s === "ready" ? "ready" : "loading"));
    apiGet(`/report-notifications/history?limit=${limit}`)
      .then((res) => {
        if (cancelled) return;
        setHistory(res ?? []);
        setStatus("ready");
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : "전송 내역을 불러오지 못했습니다.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [limit, reloadToken]);

  return { history, status, error, reload };
}
