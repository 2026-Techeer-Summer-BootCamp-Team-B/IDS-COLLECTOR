// Mock data for the Overview log dashboard.
//
// Structural choice for real-data integration: everything downstream reads
// from RAW_EVENTS (timestamp + level + source + message) and derives
// tables/charts from it via the pure functions below. To wire in a real
// source (Loki, CloudWatch, ELK, ...), replace `generateEvents()` with a
// real fetch that returns objects in the same shape — nothing else changes.
 
import { normalizeLevel } from "./logLevels";
 
export const MOCK_NOW = new Date("2026-07-10T14:30:00");
 
const SOURCES = ["api-gateway", "auth-service", "payment-service", "web-app", "worker-queue", "db-proxy"];
 
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
 
function generateEvents(count, lookbackMs) {
  const events = [];
  for (let i = 0; i < count; i++) {
    const level = normalizeLevel(weightedRandomLevel());
    const timestamp = new Date(MOCK_NOW.getTime() - Math.random() * lookbackMs);
    events.push({
      id: i + 1,
      timestamp,
      level,
      source: randomFrom(SOURCES),
      message: randomFrom(MESSAGES[level] || MESSAGES.INFO),
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
 
export function topSourcesFor(events) {
  const counts = events.reduce((acc, l) => {
    acc[l.source] = (acc[l.source] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}
 
// Default snapshot (last 24h) — used wherever a component hasn't opted into
// the range selector yet.
const last24hCutoff = MOCK_NOW.getTime() - 24 * 60 * 60 * 1000;
const last24h = RAW_EVENTS.filter((e) => e.timestamp.getTime() > last24hCutoff);
export const levelDistribution = levelDistributionFor(last24h);
export const topSources = topSourcesFor(last24h);