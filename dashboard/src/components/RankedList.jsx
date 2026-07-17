import React from "react";
import { DONUT_PALETTE, donutPalette } from "../data/theme";
import { Card } from "../views/LogDashboard";
import { useTheme } from "../hooks/useTheme";

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
              {/* 2026-07-16: 순위 막대가 mint/pink 2색 번갈이라 "WAS/WAF/Falco/
                  K8s Audit 4개 페이지 다 색이 두 개뿐"이라는 피드백 - Overview
                  도넛들과 같은 DONUT_PALETTE를 순위 인덱스로 순환시켜 순위마다
                  다른 톤이 나오도록 바꿨다(리스트가 5개 넘으면 색이 한 바퀴
                  돌아 반복되는데, 바로 옆 순위끼리는 항상 다른 색이라 구분엔
                  지장 없음). */}
              <div className="h-1.5 rounded-full bg-dash-surfaceAlt overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(item.count / max) * 100}%`,
                    backgroundColor: donutPalette(theme)[i % DONUT_PALETTE.length],
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
