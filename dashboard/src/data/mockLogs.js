// Mock data for the Overview log dashboard.
//
// Structural choice for real-data integration: everything downstream reads
// from RAW_EVENTS (timestamp + level + source + message) and derives
// tables/charts from it via the pure functions below. To wire in a real
// source (Loki, CloudWatch, ELK, ...), replace `generateEvents()` with a
// real fetch that returns objects in the same shape — nothing else changes.
 
import { normalizeLevel } from "./logLevels";
import { APP_POD_CONTEXTS } from "./clusterTopology";

export const MOCK_NOW = new Date("2026-07-10T14:30:00");

const SOURCES = ["api-gateway", "auth-service", "payment-service", "web-app", "worker-queue", "db-proxy"];

// Per-source request path pool — gives the Recent Logs drill-down something
// concrete ("정확한 경로") to show once a row is expanded, instead of just
// message/level/source with nothing to actually trace back to an endpoint.
const PATHS_BY_SOURCE = {
  "api-gateway": ["GET /api/v1/route", "GET /api/v1/health", "POST /api/v1/webhook"],
  "auth-service": ["POST /auth/login", "POST /auth/refresh", "GET /auth/session"],
  "payment-service": ["POST /payments/charge", "GET /payments/:id/status", "POST /payments/refund"],
  "web-app": ["GET /", "GET /dashboard", "GET /static/bundle.js"],
  "worker-queue": ["worker.job.process", "worker.job.retry", "worker.queue.drain"],
  "db-proxy": ["QUERY orders", "QUERY users", "QUERY sessions"],
};
 
const MESSAGES = {
  EMERGENCY: ["Service completely unresponsive", "Data corruption detected in primary store"],
  CRITICAL: ["Unhandled exception in request handler", "Database connection pool exhausted"],
  MAJOR: ["Failed to process payment", "Upstream service returned 500"],
  MINOR: ["Null reference in optional field", "Retry limit reached for background job"],
  WARNING: ["Response time exceeded 2s threshold", "Deprecated API endpoint called", "Rate limit approaching"],
  NOTICE: ["Config reloaded from remote source", "Feature flag toggled"],
  INFO: ["User login successful", "Scheduled job completed", "Order created successfully"],
  TRACE: ["Entering handler processPayment()", "Cache lookup for key user:1024"],
  DEBUG: ["Query executed in 12ms", "Session token refreshed"],
};
 
// Relative frequency per level — mirrors a realistic prod log mix (mostly
// INFO/DEBUG noise, rare EMERGENCY/CRITICAL). Tune freely.
const LEVEL_WEIGHTS = {
  EMERGENCY: 1,
  CRITICAL: 3,
  MAJOR: 8,
  MINOR: 10,
  WARNING: 15,
  NOTICE: 10,
  INFO: 35,
  TRACE: 8,
  DEBUG: 20,
};
 
function weightedRandomLevel() {
  const total = Object.values(LEVEL_WEIGHTS).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const [level, weight] of Object.entries(LEVEL_WEIGHTS)) {
    if (r < weight) return level;
    r -= weight;
  }
  return "INFO";
}
 
function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Rough "typical" response time (ms) per level — errors/warnings skew slower
// (timeouts, retries, upstream waits) while INFO/DEBUG stay fast. Used to
// synthesize a `durationMs` field on every event so a p50/p90/p99 latency
// panel has something realistic to summarize (quantile_over_time equivalent).
const LEVEL_LATENCY_BASE_MS = {
  EMERGENCY: 900,
  CRITICAL: 550,
  MAJOR: 380,
  MINOR: 160,
  WARNING: 240,
  NOTICE: 90,
  INFO: 65,
  TRACE: 18,
  DEBUG: 12,
};

// Exponential-ish jitter on top of the base gives a realistic right-skewed
// latency distribution (long tail) instead of a flat/uniform one — p99 ends
// up meaningfully higher than p50, like real request latency does.
function randomLatencyMs(level) {
  const base = LEVEL_LATENCY_BASE_MS[level] ?? 60;
  const jitter = -Math.log(1 - Math.random()) * base * 0.7;
  return Math.max(1, Math.round(base * 0.35 + jitter));
}

function generateEvents(count, lookbackMs) {
  const events = [];
  for (let i = 0; i < count; i++) {
    const level = normalizeLevel(weightedRandomLevel());
    const timestamp = new Date(MOCK_NOW.getTime() - Math.random() * lookbackMs);
    const source = randomFrom(SOURCES);
    // K8s 컨텍스트 — source(워크로드명)와 같은 워크로드의 파드 중 하나를 붙여서
    // "이 WAS 로그가 실제로 어느 네임스페이스/파드/컨테이너/노드에서 났는지"가
    // 드릴다운에서 보이게 한다. Falco/K8s Audit도 같은 clusterTopology.js를 쓰므로
    // 세 계층이 같은 파드를 가리킬 수 있음(상관분석 스토리와 일관).
    const candidates = APP_POD_CONTEXTS.filter((p) => p.workload === source);
    const k8s = candidates.length ? randomFrom(candidates) : APP_POD_CONTEXTS[0];
    events.push({
      id: i + 1,
      timestamp,
      level,
      source,
      message: randomFrom(MESSAGES[level] || MESSAGES.INFO),
      durationMs: randomLatencyMs(level),
      path: randomFrom(PATHS_BY_SOURCE[source] || ["-"]),
      namespace: k8s.namespace,
      workload: k8s.workload,
      pod: k8s.pod,
      container: k8s.container,
      image: k8s.image,
      node: k8s.node,
    });
  }
  return events.sort((a, b) => b.timestamp - a.timestamp);
}
 
// 30 days of history so every range preset (15m up to 30d) has data to show.
export const RAW_EVENTS = generateEvents(4000, 30 * 24 * 60 * 60 * 1000);
 
// Kept for convenience / backward compatibility with anything importing the
// old name directly.
export const mockLogs = RAW_EVENTS;
 
export function levelDistributionFor(events) {
  return events.reduce((acc, log) => {
    acc[log.level] = (acc[log.level] || 0) + 1;
    return acc;
  }, {});
}
 
// Nearest-rank percentile — same convention Loki/Prometheus's
// quantile_over_time uses. `values` need not be pre-sorted.
export function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

// p50/p90/p99 + avg/max over a set of events' durationMs — the
// quantile_over_time-style numeric-field stats the Overview page was
// missing (API 레이턴시 p99 같은 SOC 신뢰도 지표).
export function latencyStatsFor(events) {
  const values = events.map((e) => e.durationMs).filter((v) => typeof v === "number");
  if (!values.length) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    count: values.length,
    avg: Math.round(sum / values.length),
    max: Math.max(...values),
    p50: percentile(values, 50),
    p90: percentile(values, 90),
    p99: percentile(values, 99),
  };
}
 
// Default snapshot (last 24h) — used wherever a component hasn't opted into
// the range selector yet.
const last24hCutoff = MOCK_NOW.getTime() - 24 * 60 * 60 * 1000;
const last24h = RAW_EVENTS.filter((e) => e.timestamp.getTime() > last24hCutoff);
export const levelDistribution = levelDistributionFor(last24h);