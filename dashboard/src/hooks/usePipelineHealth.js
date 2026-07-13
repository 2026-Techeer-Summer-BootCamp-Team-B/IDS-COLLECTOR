import { useCallback, useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";

// GET /stats/consumer-lag + /stats/dlq-depth + /stats/clock-skew
// (servers/platform-api/app/pipeline_health_api.py) — "로그 소스가 조용해졌는가"를 보는
// SourceHealthPanel(mock)과 달리, 파이프라인 내부(Kafka 컨슈머/DLQ/수신 지연)가 실시간
// 유입 속도를 따라가고 있는지를 본다. 세 엔드포인트를 병렬로 불러오되, 백엔드 주석에
// "Kafka AdminClient 부분은 실제 브로커로 미검증"이라 적혀 있어 하나가 실패해도 나머지는
// 보여주도록 Promise.allSettled로 개별 처리한다. consumer-lag 응답 자체도 그룹 하나가
// 조회 실패하면 그 그룹만 error 필드를 채워 반환하므로, 여기서도 그대로 통과시킨다.
export function usePipelineHealth() {
  const [consumerLag, setConsumerLag] = useState([]);
  const [dlqDepth, setDlqDepth] = useState(null);
  const [clockSkew, setClockSkew] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setStatus((s) => (s === "ready" ? "ready" : "loading"));

    Promise.allSettled([apiGet("/stats/consumer-lag"), apiGet("/stats/dlq-depth"), apiGet("/stats/clock-skew")]).then(
      ([lagRes, dlqRes, skewRes]) => {
        if (cancelled) return;

        if (lagRes.status === "fulfilled") setConsumerLag(lagRes.value ?? []);
        if (dlqRes.status === "fulfilled") setDlqDepth(dlqRes.value ?? null);
        if (skewRes.status === "fulfilled") setClockSkew(skewRes.value ?? null);

        // 셋 다 실패했을 때만 전체 error 상태로 - 일부만 실패하면 받아온 값만 보여주고
        // 나머지는 각 패널에서 "-"로 표시한다.
        const allFailed = [lagRes, dlqRes, skewRes].every((r) => r.status === "rejected");
        if (allFailed) {
          const first = lagRes.status === "rejected" ? lagRes.reason : dlqRes.reason;
          setError(first instanceof ApiError ? first.message : "파이프라인 상태를 불러오지 못했습니다.");
          setStatus("error");
        } else {
          setError(null);
          setStatus("ready");
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return { consumerLag, dlqDepth, clockSkew, status, error, reload };
}
