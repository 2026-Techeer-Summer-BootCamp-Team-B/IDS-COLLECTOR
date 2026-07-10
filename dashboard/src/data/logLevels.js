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
 
export const LOG_LEVELS = [
  { key: "EMERGENCY", code: 1, label: "Emergency", color: "#F2617A", aliases: ["emerg", "emergency", "panic"] },
  { key: "CRITICAL", code: 2, label: "Critical", color: "#F2748A", aliases: ["crit", "critical"] },
  { key: "MAJOR", code: 3, label: "Major", color: "#F2A65A", aliases: ["major", "err", "error", "erro"] },
  { key: "MINOR", code: 4, label: "Minor", color: "#F2C48A", aliases: ["minor"] },
  { key: "WARNING", code: 5, label: "Warning", color: "#E8D97A", aliases: ["warn", "warning"] },
  { key: "NOTICE", code: 6, label: "Notice", color: "#C9E8DE", aliases: ["notice"] },
  { key: "INFO", code: 7, label: "Info", color: "#A9DFD8", aliases: ["info", "informational"] },
  { key: "TRACE", code: 8, label: "Trace", color: "#A0A0A0", aliases: ["trace"] },
  { key: "DEBUG", code: 9, label: "Debug", color: "#87888C", aliases: ["debug"] },
];
 
export const UNKNOWN_LEVEL = { key: "UNKNOWN", code: 0, label: "Unknown", color: "#5C5D66", aliases: [] };
 
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