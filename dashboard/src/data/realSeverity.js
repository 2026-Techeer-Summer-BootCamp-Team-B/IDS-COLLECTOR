// Real backend severity scale (event.severity, 1~4 — see
// servers/normalizer/app/severity.yaml). Distinct from logLevels.js's 9-tier
// RFC5424-style scale, which is only used by the still-mock views (WAS/Falco/
// K8sAudit detail pages, Incidents). Anything backed by real /stats or /logs
// data should import from here instead.
//
// severity 4 = highest (Critical), 1 = lowest (Info) — see severity.yaml's
// audit/falco/waf rule tables for how each source lands on this scale.
export const REAL_SEVERITY_LEVELS = [
  { severity: 4, key: "CRITICAL", label: "Critical", color: "#FF1F6B" },
  { severity: 3, key: "MAJOR", label: "Major", color: "#FF5A1F" },
  { severity: 2, key: "MINOR", label: "Minor", color: "#F5E400" },
  { severity: 1, key: "INFO", label: "Info", color: "#00FFA6" },
];

const BY_SEVERITY = REAL_SEVERITY_LEVELS.reduce((acc, l) => ((acc[l.severity] = l), acc), {});

export function getRealSeverityMeta(severity) {
  return (
    BY_SEVERITY[severity] || {
      severity,
      key: "UNKNOWN",
      label: severity == null ? "Unknown" : `Severity ${severity}`,
      color: "#3A3F55",
    }
  );
}

// KPI 카드/Log Volume 에러 밴드 기준 — Major(3) + Critical(4) = "Errors",
// Minor(2) = "Warnings", Info(1)은 별도 집계 없음(정상 트래픽 배경 잡음).
export const REAL_ERROR_MIN_SEVERITY = 3;
export const REAL_WARNING_SEVERITY = 2;
