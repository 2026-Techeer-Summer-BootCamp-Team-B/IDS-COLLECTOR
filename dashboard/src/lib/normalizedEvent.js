import { getModuleMeta } from "../data/moduleMeta";

// 정규화 이벤트(servers/normalizer/app/main.py가 event.model_dump_json(by_alias=True)로
// 내보내는 점 표기 flat dict)를 프론트에서 쓰기 좋은 모양으로 매핑. GET /logs
// (OpenSearch attack-logs-* _source)와 WS /ws/events(events.normalized 토픽을
// 그대로 tail)가 정확히 같은 직렬화 포맷을 쓰기 때문에 useLogs.js/useLiveFeed.js
// 둘 다 이 함수 하나를 공유한다 — 필드 파싱 로직이 두 곳에서 따로 놀다 어긋나는
// 걸 방지.
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

export function mapLogDoc(doc) {
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
