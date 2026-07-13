import React, { useMemo, useState } from "react";
import { RAW_EVENTS, MOCK_NOW, latencyStatsFor } from "../data/mockLogs";
import { ERROR_BAND } from "../data/logLevels";
import { RANGE_PRESETS } from "../data/timeSeries";
import TimeRangePicker from "../components/TimeRangePicker";
import RankedList from "../components/RankedList";
import {
  KpiCard,
  LogVolumeChart,
  LevelDistributionChart,
  LatencyStatsPanel,
  ErrorRateGauge,
  RecentLogsTable,
} from "./LogDashboard";

/**
 * WAS 상세 — 애플리케이션 계층 전용 페이지. Overview가 3계층을 종합해서 보여준다면
 * 여기는 WAS 로그(RAW_EVENTS)만 깊게 파고든다: 요청량, 상태/레벨 분포, 레이턴시
 * p50/p90/p99, Top Paths, 최근 요청 드릴다운.
 */
export default function WASView() {
  const [rangeKey, setRangeKey] = useState("24h");
  const preset = RANGE_PRESETS.find((p) => p.key === rangeKey);

  const events = useMemo(() => {
    const cutoff = MOCK_NOW.getTime() - preset.lookbackMs;
    return RAW_EVENTS.filter((e) => e.timestamp.getTime() > cutoff);
  }, [rangeKey]);

  const errorCount = events.filter((e) => ERROR_BAND.includes(e.level)).length;
  const latency = latencyStatsFor(events);

  const topPaths = useMemo(() => {
    const counts = {};
    events.forEach((e) => {
      counts[e.path] = (counts[e.path] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [events]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-dash-fg text-base font-semibold mb-1">WAS 상세</h2>
          <p className="text-dash-muted text-xs">애플리케이션 요청 로그 전용 뷰 · api-gateway / auth-service / payment-service 등</p>
        </div>
        <TimeRangePicker value={rangeKey} onChange={setRangeKey} />
      </div>

      <div className="flex flex-wrap gap-4">
        <KpiCard label={`Total Requests (${preset.label})`} value={events.length.toLocaleString()} />
        <KpiCard label="Errors (Emergency~Major)" value={errorCount} accent="critical" />
        <KpiCard label="p99 Latency" value={latency ? `${latency.p99}ms` : "-"} />
        <KpiCard label="Avg Latency" value={latency ? `${latency.avg}ms` : "-"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <LogVolumeChart rangeKey={rangeKey} />
        </div>
        <LevelDistributionChart events={events} />
      </div>

      <LatencyStatsPanel events={events} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <RecentLogsTable events={events} />
        </div>
        <div className="space-y-6">
          <RankedList title="Top Paths" subtitle="선택 구간 기준" items={topPaths} valueSuffix=" hits" />
          <ErrorRateGauge events={events} />
        </div>
      </div>
    </div>
  );
}
