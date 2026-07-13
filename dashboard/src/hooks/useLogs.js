import { useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";
import { mapLogDoc } from "../lib/normalizedEvent";

// GET /logs (servers/platform-api/app/logs_api.py) — Overview의 Recent Logs
// 테이블 / Latency 패널 / Error Rate Gauge 실데이터 소스. RAW_EVENTS(mockLogs.js)
// 대체. 응답은 NormalizedEvent를 점 표기 그대로 직렬화한 flat dict 배열
// (servers/normalizer/app/schemas.py) — 소스마다 있는 필드가 달라서(WAS만
// path/duration, Falco/Audit는 namespace/pod 위주) 테이블 한 줄에 필요한
// message 등을 소스별로 합성한다. mapLogDoc은 lib/normalizedEvent.js로 옮겨서
// useLiveFeed.js(WS /ws/events)와 파싱 로직을 공유한다 — 둘 다 같은 직렬화
// 포맷(이벤트 하나를 점 표기 flat dict로)을 받기 때문.
//
// level: 기존 9단계 mock 스케일(logLevels.js) 중 정확히 이름이 겹치는 4개
// (CRITICAL/MAJOR/MINOR/INFO)로 real severity(1~4)를 별칭 처리 — FalcoView/
// K8sAuditView가 이미 쓰는 것과 같은 패턴이라 LevelBadge/ErrorRateGauge를
// 그대로 재사용할 수 있다. Log Levels 차트만은 이 4개 외 5개가 항상 0으로
// 나오는 걸 피하려고 useLogLevels(전용 4단계 집계)를 따로 쓴다.

export function useLogs({ lookbackMs, module, minSeverity, q, limit = 300 }) {
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);

    const end = new Date();
    const start = new Date(end.getTime() - lookbackMs);
    const params = new URLSearchParams({
      start: start.toISOString(),
      end: end.toISOString(),
      limit: String(limit),
    });
    if (module) params.set("module", module);
    if (minSeverity != null) params.set("min_severity", String(minSeverity));
    if (q) params.set("q", q);

    apiGet(`/logs?${params.toString()}`)
      .then((res) => {
        if (cancelled) return;
        setLogs((res ?? []).map(mapLogDoc));
        setStatus("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        setLogs([]);
        setError(e instanceof ApiError ? e.message : "로그를 불러오지 못했습니다.");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [lookbackMs, module, minSeverity, q, limit]);

  return { logs, status, error };
}
