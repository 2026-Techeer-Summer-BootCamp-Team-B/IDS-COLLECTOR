import React, { useMemo, useState } from "react";
import { RANGE_PRESETS, LIVE_POLL_MS } from "../data/timeSeries";
import { REAL_SEVERITY_LEVELS, REAL_ERROR_MIN_SEVERITY, getRealSeverityMeta } from "../data/realSeverity";
import { useLogs } from "../hooks/useLogs";
import { useDetectionSources } from "../hooks/useDetectionSources";
import TimeRangePicker from "../components/TimeRangePicker";
import RankedList from "../components/RankedList";
import { Card, KpiCard, LogVolumeChart, RealLevelDistributionChart } from "./LogDashboard";

function RecentFalcoEvents({ events, status, error }) {
  const [expandedId, setExpandedId] = useState(null);
  return (
    <Card title="Recent Events" subtitle={`Showing ${Math.min(events.length, 10)} of ${events.length}`}>
      {status === "loading" && <p className="text-dash-muted text-xs py-3">불러오는 중...</p>}
      {status === "error" && <p className="text-dash-critical text-xs py-3">{error}</p>}
      {status === "ready" && (
      <div className="space-y-1">
        {events.slice(0, 10).map((e) => {
          const isOpen = expandedId === e.id;
          const meta = getRealSeverityMeta(e.severity);
          const ruleName = e.raw["rule.name"] || "-";
          const output = e.raw["process.command_line"] || e.raw["process.name"] || e.message;
          return (
            <div key={e.id}>
              <button
                onClick={() => setExpandedId(isOpen ? null : e.id)}
                className="w-full flex items-center gap-3 py-2 text-left text-xs hover:bg-dash-surfaceAlt/50 rounded-lg px-1"
              >
                <span className="text-dash-faint shrink-0">{isOpen ? "▾" : "▸"}</span>
                <span className="text-dash-faint whitespace-nowrap w-16 shrink-0">
                  {e.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0"
                  style={{ color: meta.color, backgroundColor: `${meta.color}22` }}
                  title={meta.label}
                >
                  {meta.label}
                </span>
                <span className="text-dash-fg truncate">{ruleName}</span>
                <span className="text-dash-muted truncate ml-auto">{e.pod || "-"}</span>
              </button>
              {isOpen && (
                <div className="ml-8 mb-2 mt-1 bg-dash-bg rounded-xl p-3 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-xs">
                  <div>
                    <p className="text-dash-faint mb-0.5">Namespace/Pod</p>
                    <p className="text-dash-fg">
                      {e.namespace || "-"}/{e.pod || "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-dash-faint mb-0.5">Container</p>
                    <p className="text-dash-fg">{e.container || "-"}</p>
                  </div>
                  <div>
                    <p className="text-dash-faint mb-0.5">Source IP</p>
                    <p className="text-dash-fg">{e.sourceIp || "-"}</p>
                  </div>
                  <div>
                    <p className="text-dash-faint mb-0.5">전체 시각</p>
                    <p className="text-dash-fg">{e.timestamp.toLocaleString("ko-KR")}</p>
                  </div>
                  <div>
                    <p className="text-dash-faint mb-0.5">Image</p>
                    <p className="text-dash-fg font-mono truncate" title={e.image}>
                      {e.image || "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-dash-faint mb-0.5">Rule</p>
                    <p className="text-dash-fg">{ruleName}</p>
                  </div>
                  <div className="col-span-2 sm:col-span-4">
                    <p className="text-dash-faint mb-0.5">Output</p>
                    <p className="text-dash-fg font-mono text-[11px] break-all">{output}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {events.length === 0 && <p className="text-dash-muted text-xs py-3">이 구간에는 이벤트가 없습니다.</p>}
      </div>
      )}
    </Card>
  );
}

/**
 * Falco 상세 — GET /logs?module=falco 실데이터 연동. Overview/Incidents는
 * 상관분석으로 확정된 이벤트만 보여주지만, 여기는 Falco가 실제로 쏟아내는 모든
 * 이벤트를 그대로 보여준다 — 실제 배포 환경의 "신호 대 잡음"을 있는 그대로 드러내는
 * 게 이 페이지의 목적. severity는 다른 모듈처럼 1~4 실 스케일(severity.yaml)을 씀.
 */
export default function FalcoView() {
  const [rangeKey, setRangeKey] = useState("24h");
  const preset = RANGE_PRESETS.find((p) => p.key === rangeKey);
  const hours = preset.lookbackMs / (60 * 60 * 1000);

  const { logs, status, error } = useLogs({
    lookbackMs: preset.lookbackMs,
    module: "falco",
    limit: 300,
    pollMs: LIVE_POLL_MS,
  });

  // Total 카드는 logs.length(limit=300 캡) 대신 GET /stats의 by_module count(정확한
  // 총량)를 쓴다 — WASView.jsx와 동일한 이유(300건 넘으면 숫자가 그대로 고정되어
  // "연동 안 된 것"처럼 보이는 문제).
  const { byModule } = useDetectionSources({ lookbackMs: preset.lookbackMs, pollMs: LIVE_POLL_MS });
  const totalEvents = byModule.find((m) => m.module === "falco")?.count ?? 0;

  const notableCount = useMemo(
    () => logs.filter((e) => e.severity >= REAL_ERROR_MIN_SEVERITY).length,
    [logs]
  );
  const distinctPods = useMemo(() => new Set(logs.map((e) => e.pod).filter(Boolean)).size, [logs]);

  const rules = useMemo(() => {
    const counts = {};
    logs.forEach((e) => {
      const name = e.raw["rule.name"];
      if (!name) return;
      counts[name] = (counts[name] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [logs]);

  const pods = useMemo(() => {
    const counts = {};
    logs.forEach((e) => {
      if (!e.pod) return;
      counts[e.pod] = (counts[e.pod] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [logs]);

  const topRule = rules[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-dash-fg text-base font-semibold mb-1">Falco 상세</h2>
          <p className="text-dash-muted text-xs">런타임 보안 이벤트 전용 뷰 (module=falco) · 컨테이너 syscall 기반 탐지</p>
        </div>
        <TimeRangePicker value={rangeKey} onChange={setRangeKey} />
      </div>

      <div className="flex flex-wrap gap-4">
        <KpiCard label={`Total Events (${preset.label})`} value={totalEvents.toLocaleString()} />
        <KpiCard label="Notable (Major~Critical)" value={notableCount} accent="critical" />
        <KpiCard label="Distinct Pods" value={distinctPods} />
        <KpiCard label="Top Rule" value={topRule ? topRule.count : "-"} delta={topRule?.label} positive />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <LogVolumeChart rangeKey={rangeKey} module="falco" />
        </div>
        <RealLevelDistributionChart hours={hours} module="falco" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <RankedList title="Rule 위반 랭킹" subtitle={`총 ${rules.length}개 룰`} items={rules} />
        <RankedList title="Top Pods" subtitle="이벤트 발생 기준" items={pods} />
      </div>

      <RecentFalcoEvents events={logs} status={status} error={error} />
    </div>
  );
}
