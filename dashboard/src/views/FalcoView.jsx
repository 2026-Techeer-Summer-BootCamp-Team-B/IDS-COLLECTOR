import React, { useMemo, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceDot } from "recharts";
import { FALCO_EVENTS, byRule, byPod } from "../data/falcoLogs";
import { MOCK_NOW } from "../data/mockLogs";
import { ERROR_BAND, getLevelMeta, getDisplayTier } from "../data/logLevels";
import { RANGE_PRESETS, bucketEvents, detectSpike } from "../data/timeSeries";
import { CHART_COLORS } from "../data/theme";
import { useTheme } from "../hooks/useTheme";
import TimeRangePicker from "../components/TimeRangePicker";
import RankedList from "../components/RankedList";
import { Card, KpiCard, LevelDistributionChart } from "./LogDashboard";

// Falco 이벤트는 timestamp/level만 있으면 되는 bucketEvents/LevelDistributionChart를
// 그대로 재사용할 수 있게 priority -> level로 별칭만 붙여준다 (필드명만 다를 뿐
// 같은 9단계 심각도 스케일이라 값 매핑은 필요 없음).
function withLevelAlias(events) {
  return events.map((e) => ({ ...e, level: e.priority }));
}

function EventsRateChart({ events, rangeKey }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const preset = RANGE_PRESETS.find((p) => p.key === rangeKey);
  const data = useMemo(() => {
    const buckets = bucketEvents(withLevelAlias(events), preset, MOCK_NOW.getTime());
    return buckets.map((b) => {
      const total = Object.values(b.counts).reduce((a, c) => a + c, 0);
      const notable = ERROR_BAND.reduce((sum, key) => sum + (b.counts[key] || 0), 0);
      return { label: b.label, total, notable };
    });
  }, [events, rangeKey]);
  const spike = useMemo(() => detectSpike(data.map((d) => d.total)), [data]);
  const spikePoint = spike ? data[spike.index] : null;

  return (
    <Card
      title="Events Rate"
      subtitle={`Last ${preset.label} · ${data.length} buckets`}
      action={
        spike && (
          <span className="text-[11px] font-medium px-2 py-1 rounded-md bg-dash-pink/15 text-dash-pink whitespace-nowrap">
            ⚠ {spikePoint.label} 평소 대비 +{spike.pctOverBaseline}% 급증
          </span>
        )
      }
      className="h-72"
    >
      <ResponsiveContainer width="100%" height="85%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="falcoFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.mint} stopOpacity={0.45} />
              <stop offset="100%" stopColor={C.mint} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={C.surfaceAlt} vertical={false} />
          <XAxis dataKey="label" stroke={C.muted} tickLine={false} axisLine={false} fontSize={11} minTickGap={24} />
          <YAxis stroke={C.muted} tickLine={false} axisLine={false} fontSize={12} />
          <Tooltip contentStyle={{ background: C.surfaceAlt, border: "none", borderRadius: 8, color: C.fg }} />
          <Area type="monotone" dataKey="total" stroke={C.mint} fill="url(#falcoFill)" strokeWidth={2} />
          {spikePoint && (
            <ReferenceDot x={spikePoint.label} y={spikePoint.total} r={5} fill={C.pink} stroke={C.bg} strokeWidth={2} ifOverflow="extendDomain" />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  );
}

function RecentFalcoEvents({ events }) {
  const [expandedId, setExpandedId] = useState(null);
  return (
    <Card title="Recent Events" subtitle={`Showing ${Math.min(events.length, 10)} of ${events.length}`}>
      <div className="space-y-1">
        {events.slice(0, 10).map((e) => {
          const isOpen = expandedId === e.id;
          const meta = getLevelMeta(e.priority);
          const tier = getDisplayTier(e.priority);
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
                  style={{ color: tier.color, backgroundColor: `${tier.color}22` }}
                  title={`${tier.label} tier`}
                >
                  {meta.label}
                </span>
                <span className="text-dash-fg truncate">{e.rule}</span>
                <span className="text-dash-muted truncate ml-auto">{e.pod}</span>
              </button>
              {isOpen && (
                <div className="ml-8 mb-2 mt-1 bg-dash-bg rounded-xl p-3 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-xs">
                  <div>
                    <p className="text-dash-faint mb-0.5">Namespace/Pod</p>
                    <p className="text-dash-fg">
                      {e.namespace}/{e.pod}
                    </p>
                  </div>
                  <div>
                    <p className="text-dash-faint mb-0.5">Container</p>
                    <p className="text-dash-fg">{e.container}</p>
                  </div>
                  <div>
                    <p className="text-dash-faint mb-0.5">Node</p>
                    <p className="text-dash-fg">{e.node}</p>
                  </div>
                  <div>
                    <p className="text-dash-faint mb-0.5">전체 시각</p>
                    <p className="text-dash-fg">{e.timestamp.toLocaleString("ko-KR")}</p>
                  </div>
                  <div>
                    <p className="text-dash-faint mb-0.5">Image</p>
                    <p className="text-dash-fg font-mono truncate" title={e.image}>
                      {e.image}
                    </p>
                  </div>
                  <div>
                    <p className="text-dash-faint mb-0.5">Source</p>
                    <p className="text-dash-fg">{e.source}</p>
                  </div>
                  <div className="col-span-2 sm:col-span-4">
                    <p className="text-dash-faint mb-0.5">Output</p>
                    <p className="text-dash-fg font-mono text-[11px] break-all">{e.output}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {events.length === 0 && <p className="text-dash-muted text-xs py-3">이 구간에는 이벤트가 없습니다.</p>}
      </div>
    </Card>
  );
}

/**
 * Falco 상세 — 런타임 보안 계층 전용 페이지. Overview/Incidents는 공격으로
 * 확정(상관분석)된 Falco 이벤트만 보여주지만, 여기는 Falco가 실제로 쏟아내는
 * 모든 이벤트(대부분 NOTICE 노이즈)를 그대로 보여준다 — 실제 Falco 배포 환경의
 * "신호 대 잡음"을 있는 그대로 드러내는 게 이 페이지의 목적.
 */
export default function FalcoView() {
  const [rangeKey, setRangeKey] = useState("24h");
  const preset = RANGE_PRESETS.find((p) => p.key === rangeKey);

  const events = useMemo(() => {
    const cutoff = MOCK_NOW.getTime() - preset.lookbackMs;
    return FALCO_EVENTS.filter((e) => e.timestamp.getTime() > cutoff);
  }, [rangeKey]);

  const notableCount = events.filter((e) => ERROR_BAND.includes(e.priority)).length;
  const distinctSources = new Set(events.map((e) => e.source)).size;
  const rules = useMemo(() => byRule(events), [events]);
  const pods = useMemo(() => byPod(events).map((p) => ({ label: p.key, count: p.count })), [events]);
  const topRule = rules[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-dash-fg text-base font-semibold mb-1">Falco 상세</h2>
          <p className="text-dash-muted text-xs">런타임 보안 이벤트 전용 뷰 · 컨테이너 syscall 기반 탐지</p>
        </div>
        <TimeRangePicker value={rangeKey} onChange={setRangeKey} />
      </div>

      <div className="flex flex-wrap gap-4">
        <KpiCard label={`Total Events (${preset.label})`} value={events.length.toLocaleString()} />
        <KpiCard label="Notable (Critical~Major)" value={notableCount} accent="critical" />
        <KpiCard label="Sources" value={distinctSources} />
        <KpiCard label="Top Rule" value={topRule ? topRule.count : "-"} delta={topRule?.rule} positive />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <EventsRateChart events={events} rangeKey={rangeKey} />
        </div>
        <LevelDistributionChart events={withLevelAlias(events)} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <RankedList title="Rule 위반 랭킹" subtitle={`총 ${rules.length}개 룰`} items={rules.map((r) => ({ label: r.rule, count: r.count }))} />
        <RankedList title="Top Pods" subtitle="이벤트 발생 기준" items={pods} />
      </div>

      <RecentFalcoEvents events={events} />
    </div>
  );
}
