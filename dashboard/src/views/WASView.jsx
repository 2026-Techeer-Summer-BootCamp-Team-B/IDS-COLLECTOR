import React, { useMemo, useState } from "react";
import { latencyStatsFor } from "../data/mockLogs";
import { RANGE_PRESETS } from "../data/timeSeries";
import { REAL_SEVERITY_LEVELS } from "../data/realSeverity";
import { useLogs } from "../hooks/useLogs";
import { useDetectionSources } from "../hooks/useDetectionSources";
import { usePollInterval } from "../context/PollIntervalContext";
import TimeRangePicker from "../components/TimeRangePicker";
import RankedList from "../components/RankedList";
import {
  KpiCard,
  LogVolumeChart,
  RealLevelDistributionChart,
  LatencyStatsPanel,
  ErrorRateGauge,
  RecentLogsTable,
} from "./LogDashboard";

/**
 * WAS 상세 — GET /logs?module=was 실데이터 연동. event.severity는 normalizer가
 * WAS 원본 access log엔 판단을 얹지 않고 항상 1(Info)로 고정하기 때문에(severity.yaml
 * 참고), "Errors" KPI/Error Rate Gauge는 severity 대신 HTTP 상태코드(>=400)
 * 기준으로 다시 정의했다 — 안 그러면 이 페이지에서만 상시 0으로 보여서 의미가 없다.
 */
export default function WASView() {
  const [rangeKey, setRangeKey] = useState("24h");
  const preset = RANGE_PRESETS.find((p) => p.key === rangeKey);
  const hours = preset.lookbackMs / (60 * 60 * 1000);
  const { pollMs } = usePollInterval();

  const { logs, status, error } = useLogs({
    lookbackMs: preset.lookbackMs,
    module: "was",
    limit: 300,
    pollMs,
  });

  // Total 카드는 logs.length(=limit 300으로 잘린 배열 길이)를 쓰면 실제 건수가 300을
  // 넘는 순간부터 300에 고정되어 "연동이 안 된 것"처럼 보인다. GET /stats(track_total_hits
  // 적용됨)의 by_module count를 따로 받아서 정확한 총량을 쓴다 — logs 배열 자체는
  // 에러율/레이턴시/Top Path 등 "최근 300건 기준" 지표에는 그대로 쓰인다.
  const { byModule } = useDetectionSources({ lookbackMs: preset.lookbackMs, pollMs });
  const totalRequests = byModule.find((m) => m.module === "was")?.count ?? 0;

  const errorCount = useMemo(
    () => logs.filter((e) => (e.raw["http.response.status_code"] ?? 0) >= 400).length,
    [logs]
  );
  const latency = useMemo(() => latencyStatsFor(logs), [logs]);

  // ErrorRateGauge는 events[].level이 ERROR_BAND(EMERGENCY/CRITICAL/MAJOR)에
  // 속하는지로 비율을 낸다 — WAS는 severity가 항상 1이라 그대로 넘기면 0%로
  // 고정되므로, HTTP 상태코드 기준으로 이 컴포넌트에 한해서만 level을 다시 매긴다.
  const gaugeEvents = useMemo(
    () =>
      logs.map((e) => ({
        ...e,
        level: (e.raw["http.response.status_code"] ?? 0) >= 400 ? "MAJOR" : "INFO",
      })),
    [logs]
  );

  const topPaths = useMemo(() => {
    const counts = {};
    logs.forEach((e) => {
      const key = e.path || "-";
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [logs]);

  const statusCodes = useMemo(() => {
    const counts = {};
    logs.forEach((e) => {
      const code = e.raw["http.response.status_code"];
      if (code == null) return;
      counts[code] = (counts[code] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [logs]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-dash-fg text-base font-semibold mb-1">WAS 상세</h2>
          <p className="text-dash-muted text-xs">애플리케이션 요청 로그 전용 뷰 (module=was) · nginx 액세스 로그 기반</p>
        </div>
        <TimeRangePicker value={rangeKey} onChange={setRangeKey} />
      </div>

      <div className="flex flex-wrap gap-4">
        <KpiCard label={`Total Requests (${preset.label})`} value={`${totalRequests.toLocaleString()}건`} />
        <KpiCard label="Errors (HTTP 4xx/5xx)" value={`${errorCount}건`} accent="critical" />
        <KpiCard label="p99 Latency" value={latency ? `${latency.p99}ms` : "-"} />
        <KpiCard label="Avg Latency" value={latency ? `${latency.avg}ms` : "-"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <LogVolumeChart rangeKey={rangeKey} module="was" />
        </div>
        <RealLevelDistributionChart hours={hours} module="was" />
      </div>

      <LatencyStatsPanel events={logs} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <RecentLogsTable events={logs} filterLevels={REAL_SEVERITY_LEVELS} status={status} error={error} />
        </div>
        <div className="space-y-6">
          <RankedList title="Top Paths" subtitle="선택 구간 기준" items={topPaths} valueSuffix=" hits" />
          <RankedList title="상태 코드 분포" subtitle="HTTP status code" items={statusCodes} valueSuffix=" hits" />
          <ErrorRateGauge events={gaugeEvents} title="Error Rate" subtitle="HTTP 4xx/5xx 비중" />
        </div>
      </div>
    </div>
  );
}
