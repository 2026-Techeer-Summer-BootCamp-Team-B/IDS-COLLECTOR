import React from "react";
import { AlertTriangle, AlertCircle, Info, Globe, Eye, Boxes, Loader2, CheckCircle2 } from "lucide-react";
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
  CRITICAL: { label: "CRITICAL", color: "#FF1F4B", icon: AlertTriangle },
  HIGH: { label: "HIGH", color: "#FF7A18", icon: AlertCircle },
  MEDIUM: { label: "MEDIUM", color: "#F5E400", icon: AlertCircle },
  LOW: { label: "LOW", color: "#6B7BAA", icon: Info },
};

export const SOURCE_META = {
  WAS: { label: "WAS", color: "#1F57FF", icon: Globe },
  Falco: { label: "Falco", color: "#A64DFF", icon: Eye },
  "K8s Audit": { label: "K8s Audit", color: "#22C55E", icon: Boxes },
};

export function SeverityBadge({ level }) {
  const { theme } = useTheme();
  const meta = SEVERITY_META[level] || SEVERITY_META.LOW;
  const color = forTheme(meta.color, theme);
  const Icon = meta.icon;
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-semibold tracking-wide px-1.5 py-0.5 rounded"
      style={{ color, backgroundColor: `${color}22` }}
    >
      <Icon className="w-3 h-3" />
      {meta.label}
    </span>
  );
}

export function SourceBadge({ source }) {
  const { theme } = useTheme();
  const meta = SOURCE_META[source] || { label: source, color: "#8890B5" };
  const color = forTheme(meta.color, theme);
  const Icon = meta.icon;
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap"
      style={{ color, backgroundColor: `${color}1A` }}
    >
      {Icon && <Icon className="w-3 h-3" />}
      {meta.label}
    </span>
  );
}

export function StatusDot({ status }) {
  const { theme } = useTheme();
  // status: "IN_PROGRESS" | "RESOLVED"
  const isLive = status === "IN_PROGRESS";
  const color = forTheme(isLive ? "#FF1F4B" : "#39FF6A", theme);
  const Icon = isLive ? Loader2 : CheckCircle2;
  return (
    <span className="flex items-center gap-1 text-[11px] whitespace-nowrap" style={{ color }}>
      <Icon className={`w-3 h-3 ${isLive ? "animate-spin" : ""}`} />
      {isLive ? "진행중" : "조사완료"}
    </span>
  );
}
