import React from "react";
import { CHART_COLORS } from "../data/theme";
import { useTheme } from "../hooks/useTheme";
import { Card } from "../views/LogDashboard";

/**
 * Shared "ranked bar list" used across the per-layer detail pages (WAS Top
 * Paths, Falco Top Pods, K8s Audit Top Users/Resources) — same visual
 * pattern Overview's TopSources already used, generalized so each page
 * doesn't reimplement its own bar-ranking widget.
 *
 * items: [{ label, count, sub? }] — pre-sorted, this just renders + bars.
 */
export default function RankedList({ title, subtitle, items, limit = 8, valueSuffix = "" }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const max = items[0]?.count || 1;

  return (
    <Card title={title} subtitle={subtitle}>
      <div className="space-y-3">
        {items.slice(0, limit).map((item, i) => (
          <div key={item.label} className="flex items-center gap-3">
            <span className="text-dash-muted text-xs w-4">{String(i + 1).padStart(2, "0")}</span>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between text-xs mb-1 gap-2">
                <span className="text-dash-fg truncate">{item.label}</span>
                <span className="text-dash-muted whitespace-nowrap">
                  {item.count.toLocaleString()}
                  {valueSuffix}
                  {item.sub ? <span className="text-dash-faint"> · {item.sub}</span> : null}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-dash-surfaceAlt overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(item.count / max) * 100}%`,
                    backgroundColor: i % 2 === 0 ? C.mint : C.pink,
                  }}
                />
              </div>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="text-dash-muted text-xs">데이터가 없습니다.</p>}
      </div>
    </Card>
  );
}
