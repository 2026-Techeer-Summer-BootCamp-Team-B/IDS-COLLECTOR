import { useEffect, useState } from "react";
import { apiGet, ApiError } from "../lib/authApi";
import { getModuleMeta } from "../data/moduleMeta";

// GET /logs (servers/platform-api/app/logs_api.py) — Overview의 Recent Logs
// 테이블 / Latency 패널 / Error Rate Gauge 실데이터 소스. RAW_EVENTS(mockLogs.js)
// 대체. 응답은 NormalizedEvent를 점 표기 그대로 직렬화한 flat dict 배열
// (servers/normalizer/app/schemas.py) — 소스마다 있는 필드가 달라서(WAS만
// path/duration, Falco/Audit는 namespace/pod 위주) 테이블 한 줄에 필요한
// message 등을 소스별로 합성한다.
//
// level: 기존 9단계 mock 스케일(logLevels.js) 중 정확히 이름이 겹치는 4개
// (CRITICAL/MAJOR/MINOR/INFO)로 real severity(1~4)를 별칭 처리 — FalcoView/
// K8sAuditView가 이미 쓰는 것과 같은 패턴이라 LevelBadge/ErrorRateGauge를
// 그대로 재사용할 수 있다. Log Levels 차트만은 이 4개 외 5개가 항상 0으로
// 나오는 걸 피하려고 useLogLevels(전용 4단계 집계)를 따로 쓴다.
const SEVERITY_TO_LEVEL_KEY = { 4: "CRITICAL", 3: "MAJOR", 2: "MINOR", 1: "INFO" };

function synthesizeMessage(doc) {
  const module = doc["event.module"];
  if (module === "was") {
    const method = doc["http.request.method"] ?? "";
    const path = doc["url.path"] ?? "";
    const status = doc["http.response.status_code"];
    const line = `${method} ${path}`.trim();
    return status != null ? `${line} → ${status}` : line || "요청";
  }
  if (module === "falco") {
    return doc["rule.name"] || doc["event.action"] || "Falco 탐지";
  }
  if (module === "k8s_audit") {
    return doc["event.action"] || "K8s Audit 이벤트";
  }
  return doc["event.action"] || doc["event.dataset"] || "-";
}

function mapLogDoc(doc) {
  const module = doc["event.module"];
  const severity = doc["event.severity"] ?? 1;
  const durationNs = doc["event.duration"];
  return {
    id: doc["event.id"],
    timestamp: new Date(doc["@timestamp"]),
    severity,
    level: SEVERITY_TO_LEVEL_KEY[severity] || "INFO",
    module,
    source: getModuleMeta(module).label,
    message: synthesizeMessage(doc),
    sourceIp: doc["source.ip"] ?? null,
    path: doc["url.path"] ?? "-",
    durationMs: typeof durationNs === "number" ? Math.round(durationNs / 1_000_000) : undefined,
    namespace: doc["orchestrator.namespace"],
    pod: doc["orchestrator.resource.name"],
    container: doc["container.name"] || doc["container.id"],
    image: doc["container.image.name"],
    raw: doc,
  };
}

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
