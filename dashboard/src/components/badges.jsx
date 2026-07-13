import React from "react";
import { useTheme } from "../hooks/useTheme";
import { forTheme } from "../data/theme";

/**
 * Shared badges for the SENTINEL-OPS views (Incidents, ATT&CK).
 *
 * NOTE: critical/high/medium/live/waf colors are additions beyond the
 * original 10-color reference palette — severity and source coding need
 * more distinguishable hues than the 2 accent colors (mint/pink) the
 * palette provides. Falco reuses pink, K8s Audit reuses mint, so those two
 * stay within the original palette.
 */

export const SEVERITY_META = {
  CRITICAL: { label: "CRITICAL", color: "#FF1F4B" },
  HIGH: { label: "HIGH", color: "#FF7A18" },
  MEDIUM: { label: "MEDIUM", color: "#F5E400" },
  LOW: { label: "LOW", color: "#6B7BAA" },
};

export const SOURCE_META = {
  WAS: { label: "WAS", color: "#00C2FF" },
  Falco: { label: "Falco", color: "#A64DFF" },
  "K8s Audit": { label: "K8s Audit", color: "#00FFA6" },
};

export function SeverityBadge({ level }) {
  const { theme } = useTheme();
  const meta = SEVERITY_META[level] || SEVERITY_META.LOW;
  const color = forTheme(meta.color, theme);
  return (
    <span
      className="text-[10px] font-semibold tracking-wide px-1.5 py-0.5 rounded"
      style={{ color, backgroundColor: `${color}22` }}
    >
      {meta.label}
    </span>
  );
}

export function SourceBadge({ source }) {
  const { theme } = useTheme();
  const meta = SOURCE_META[source] || { label: source, color: "#8890B5" };
  const color = forTheme(meta.color, theme);
  return (
    <span
      className="text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap"
      style={{ color, backgroundColor: `${color}1A` }}
    >
      {meta.label}
    </span>
  );
}

export function StatusDot({ status }) {
  const { theme } = useTheme();
  // status: "IN_PROGRESS" | "RESOLVED"
  const isLive = status === "IN_PROGRESS";
  const color = forTheme(isLive ? "#FF1F4B" : "#39FF6A", theme);
  return (
    <span className="flex items-center gap-1 text-[11px] whitespace-nowrap" style={{ color }}>
      <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: color }} />
      {isLive ? "진행중" : "조사완료"}
    </span>
  );
}
