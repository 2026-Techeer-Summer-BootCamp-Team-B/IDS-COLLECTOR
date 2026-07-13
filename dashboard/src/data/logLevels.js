// Canonical log-level severity scale for the Overview log dashboard.
// Mirrors the syslog / SNMP trap-filter severity table (EMERGENCY 1 ... DEBUG 9)
// instead of the old 4-tier ERROR/WARN/INFO/DEBUG shortcut.
//
// This is the single source of truth: order, numeric code, color, and label
// all live here. Every component (badges, charts, filters) should import
// from this file instead of hard-coding its own level list.
//
// `aliases` exist for when real log data comes in — real sources rarely use
// these exact strings (think "ERRO", "warning", "err", "FATAL", "Information").
// normalizeLevel() maps whatever comes in to one of these canonical keys, the
// same job Loki's `detected_level` feature does. Extend the aliases arrays
// as you wire in real sources and discover new spellings.
 
// Neon gradient: red (most severe) -> orange/yellow (mid) -> cyan/green
// (benign) -> muted blue-gray (trace/debug) — reads at a glance on the
// near-black background instead of the old low-contrast pastel ladder.
export const LOG_LEVELS = [
  { key: "EMERGENCY", code: 1, label: "Emergency", color: "#FF0844", aliases: ["emerg", "emergency", "panic"] },
  { key: "CRITICAL", code: 2, label: "Critical", color: "#FF1F6B", aliases: ["crit", "critical"] },
  { key: "MAJOR", code: 3, label: "Major", color: "#FF5A1F", aliases: ["major", "err", "error", "erro"] },
  { key: "MINOR", code: 4, label: "Minor", color: "#FF9500", aliases: ["minor"] },
  { key: "WARNING", code: 5, label: "Warning", color: "#F5E400", aliases: ["warn", "warning"] },
  { key: "NOTICE", code: 6, label: "Notice", color: "#00E5B0", aliases: ["notice"] },
  { key: "INFO", code: 7, label: "Info", color: "#00FFA6", aliases: ["info", "informational"] },
  { key: "TRACE", code: 8, label: "Trace", color: "#6B7BAA", aliases: ["trace"] },
  { key: "DEBUG", code: 9, label: "Debug", color: "#5A6288", aliases: ["debug"] },
];

export const UNKNOWN_LEVEL = { key: "UNKNOWN", code: 0, label: "Unknown", color: "#3A3F55", aliases: [] };
 
export const ALL_LEVELS = [...LOG_LEVELS, UNKNOWN_LEVEL];
 
// Semantic bands used for KPI roll-ups (e.g. the "Errors" / "Warnings" cards) —
// adjust the grouping here if your real severity mapping differs.
export const ERROR_BAND = ["EMERGENCY", "CRITICAL", "MAJOR"];
export const WARN_BAND = ["MINOR", "WARNING"];
 
const ALIAS_LOOKUP = ALL_LEVELS.reduce((acc, lvl) => {
  acc[lvl.key.toLowerCase()] = lvl.key;
  lvl.aliases.forEach((a) => (acc[a.toLowerCase()] = lvl.key));
  return acc;
}, {});
 
// Normalizes an arbitrary raw level string from a real log line into one of
// the canonical LOG_LEVELS keys above. Falls back to UNKNOWN so unexpected
// level strings from a new source don't break anything downstream.
export function normalizeLevel(raw) {
  if (!raw) return UNKNOWN_LEVEL.key;
  return ALIAS_LOOKUP[String(raw).trim().toLowerCase()] || UNKNOWN_LEVEL.key;
}
 
export function getLevelMeta(key) {
  return ALL_LEVELS.find((l) => l.key === key) || UNKNOWN_LEVEL;
}

// 사람이 훑어보는 뱃지/색상용 4단계 요약 뷰. 데이터 자체(위 9단계, ERROR_BAND 등
// 필터/상관분석 로직)는 그대로 정밀하게 유지하고, 배지처럼 "한눈에 스캔"하는
// 지점만 여기로 색상을 뽑아 쓴다 — 라벨 텍스트는 원래 레벨(MAJOR, NOTICE 등)을
// 그대로 보여주되, 색은 4개 시맨틱 버킷(Error/Warn/Info/Debug)으로 뭉쳐서
// 색상 종류를 줄이는 절충안. Datadog/Kibana류 대시보드가 흔히 쓰는 패턴.
export const DISPLAY_TIERS = [
  { key: "ERROR", label: "Error", color: "#FF1F4B", levels: ["EMERGENCY", "CRITICAL", "MAJOR"] },
  { key: "WARN", label: "Warn", color: "#F5E400", levels: ["MINOR", "WARNING"] },
  { key: "INFO", label: "Info", color: "#00FFA6", levels: ["NOTICE", "INFO"] },
  { key: "DEBUG", label: "Debug", color: "#5A6288", levels: ["TRACE", "DEBUG"] },
];

const TIER_LOOKUP = DISPLAY_TIERS.reduce((acc, tier) => {
  tier.levels.forEach((lvl) => (acc[lvl] = tier));
  return acc;
}, {});

export function getDisplayTier(key) {
  return TIER_LOOKUP[key] || { key: "UNKNOWN", label: "Unknown", color: UNKNOWN_LEVEL.color, levels: [] };
}