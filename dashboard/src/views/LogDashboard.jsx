import React, { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { RAW_EVENTS, MOCK_NOW, levelDistributionFor, topSourcesFor } from "../data/mockLogs";
import { ALL_LEVELS, ERROR_BAND, WARN_BAND, getLevelMeta } from "../data/logLevels";
import { RANGE_PRESETS, bucketEvents } from "../data/timeSeries";

/**
 * Log Analytics Dashboard — first-pass layout
 * ------------------------------------------------
 * Setup: npm i recharts
 * Tailwind: use the included tailwind.config.js (adds the "dash" color tokens).
 * Log levels: canonical 9-tier scale lives in logLevels.js (not hard-coded here).
 * Time range: Loki-style range presets live in timeSeries.js.
 * Everything lives in one file on purpose so it's easy to scan; split into
 * components/* whenever you're ready to break it apart.
 */

const C = {
  bg: "#171821",
  surface: "#21222D",
  surfaceAlt: "#2B2B36",
  mint: "#A9DFD8",
  pink: "#F2C8ED",
  muted: "#87888C",
  faint: "#A0A0A0",
};

const NAV_ITEMS = [
  { label: "Dashboard", active: true },
  { label: "Logs" },
  { label: "Alerts" },
  { label: "Sources" },
  { label: "Reports" },
  { label: "Settings" },
];

// ---------- layout primitives ----------

function Sidebar() {
  return (
    <aside className="hidden lg:flex w-60 shrink-0 flex-col bg-dash-bg border-r border-dash-surfaceAlt px-5 py-6">
      <div className="flex items-center gap-2 mb-8 px-1">
        <div className="w-8 h-8 rounded-lg bg-dash-mint/20 flex items-center justify-center">
          <span className="w-3 h-3 rounded-sm bg-dash-mint" />
        </div>
        <span className="text-white font-semibold tracking-tight">LogBoard</span>
      </div>

      <nav className="flex-1 space-y-1">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.label}
            className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
              item.active
                ? "bg-dash-surface text-white"
                : "text-dash-muted hover:bg-dash-surface/60 hover:text-white"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="pt-4 border-t border-dash-surfaceAlt space-y-1">
        <button className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-dash-muted hover:text-white">
          Favorites
        </button>
        <button className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-dash-muted hover:text-white">
          History
        </button>
        <button className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-dash-muted hover:text-white">
          Sign out
        </button>
      </div>
    </aside>
  );
}

function Topbar() {
  return (
    <header className="flex items-center gap-4 px-6 py-4 border-b border-dash-surfaceAlt">
      <div className="flex-1 max-w-md">
        <input
          placeholder="Search logs, sources, traces..."
          className="w-full bg-dash-surface text-sm text-white placeholder-dash-muted rounded-lg px-4 py-2 outline-none focus:ring-1 focus:ring-dash-mint"
        />
      </div>
      <div className="flex items-center gap-2 ml-auto text-dash-muted text-sm">
        <span className="w-2 h-2 rounded-full bg-dash-pink inline-block" />
        <span>3 active alerts</span>
      </div>
      <div className="w-9 h-9 rounded-full bg-dash-surfaceAlt flex items-center justify-center text-white text-sm">
        용
      </div>
    </header>
  );
}

function Card({ title, subtitle, action, children, className = "" }) {
  return (
    <div className={`bg-dash-surface rounded-2xl p-5 ${className}`}>
      {(title || action) && (
        <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
          <div>
            {title && <h3 className="text-white text-sm font-semibold">{title}</h3>}
            {subtitle && <p className="text-dash-muted text-xs mt-0.5">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

function KpiCard({ label, value, delta, positive = true }) {
  return (
    <div className="bg-dash-surface rounded-2xl p-5 flex-1 min-w-[160px]">
      <p className="text-dash-muted text-xs mb-2">{label}</p>
      <p className="text-white text-2xl font-semibold">{value}</p>
      {delta && (
        <p className={`text-xs mt-1 ${positive ? "text-dash-mint" : "text-dash-pink"}`}>
          {positive ? "▲" : "▼"} {delta} vs 이전 구간
        </p>
      )}
    </div>
  );
}

function LevelBadge({ level }) {
  const meta = getLevelMeta(level);
  return (
    <span
      className="text-xs font-medium px-2 py-1 rounded-md whitespace-nowrap"
      style={{ color: meta.color, backgroundColor: `${meta.color}22` }}
    >
      {meta.label}
    </span>
  );
}

// ---------- charts ----------

function LogVolumeChart({ rangeKey, onRangeChange }) {
  const preset = RANGE_PRESETS.find((p) => p.key === rangeKey);
  const data = useMemo(() => {
    const buckets = bucketEvents(RAW_EVENTS, preset, MOCK_NOW.getTime());
    return buckets.map((b) => {
      const total = Object.values(b.counts).reduce((a, c) => a + c, 0);
      const errorish = ERROR_BAND.reduce((sum, key) => sum + (b.counts[key] || 0), 0);
      return { label: b.label, total, errorish };
    });
  }, [rangeKey]);

  return (
    <Card
      title="Log Volume"
      subtitle={`지난 ${preset.label} · ${data.length}개 구간`}
      className="h-80"
      action={
        <div className="flex flex-wrap gap-1">
          {RANGE_PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => onRangeChange(p.key)}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                rangeKey === p.key ? "bg-dash-surfaceAlt text-white" : "text-dash-muted hover:text-white"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      }
    >
      <ResponsiveContainer width="100%" height="82%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="volumeFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.mint} stopOpacity={0.45} />
              <stop offset="100%" stopColor={C.mint} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="errorFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F2617A" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#F2617A" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={C.surfaceAlt} vertical={false} />
          <XAxis dataKey="label" stroke={C.muted} tickLine={false} axisLine={false} fontSize={11} minTickGap={24} />
          <YAxis stroke={C.muted} tickLine={false} axisLine={false} fontSize={12} />
          <Tooltip contentStyle={{ background: C.surfaceAlt, border: "none", borderRadius: 8, color: "#fff" }} />
          <Area type="monotone" dataKey="total" stroke={C.mint} fill="url(#volumeFill)" strokeWidth={2} />
          <Area type="monotone" dataKey="errorish" stroke="#F2617A" fill="url(#errorFill)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
      <div className="flex gap-4 text-xs text-dash-muted mt-2">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-dash-mint inline-block" /> 전체 로그
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: "#F2617A" }} /> Emergency~Major
        </span>
      </div>
    </Card>
  );
}

function LevelDistributionChart({ events }) {
  const dist = levelDistributionFor(events);
  const data = ALL_LEVELS.filter((l) => l.key !== "UNKNOWN" || dist.UNKNOWN).map((l) => ({
    key: l.key,
    level: l.label,
    count: dist[l.key] || 0,
    color: l.color,
  }));

  return (
    <Card title="Log Levels" subtitle={`선택 구간 · ${events.length}건`} className="h-80">
      <ResponsiveContainer width="100%" height="88%">
        <BarChart data={data} margin={{ bottom: 16 }}>
          <CartesianGrid stroke={C.surfaceAlt} vertical={false} />
          <XAxis
            dataKey="level"
            stroke={C.muted}
            tickLine={false}
            axisLine={false}
            fontSize={10}
            interval={0}
            angle={-30}
            textAnchor="end"
          />
          <YAxis stroke={C.muted} tickLine={false} axisLine={false} fontSize={12} />
          <Tooltip contentStyle={{ background: C.surfaceAlt, border: "none", borderRadius: 8, color: "#fff" }} />
          <Bar dataKey="count" radius={[6, 6, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.key} fill={d.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

function TopSources({ sources }) {
  const max = sources[0]?.count || 1;
  return (
    <Card title="Top Log Sources" subtitle="선택 구간 기준">
      <div className="space-y-3">
        {sources.slice(0, 5).map((s, i) => (
          <div key={s.name} className="flex items-center gap-3">
            <span className="text-dash-muted text-xs w-4">{String(i + 1).padStart(2, "0")}</span>
            <div className="flex-1">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-white">{s.name}</span>
                <span className="text-dash-muted">{s.count}</span>
              </div>
              <div className="h-1.5 rounded-full bg-dash-surfaceAlt overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(s.count / max) * 100}%`,
                    backgroundColor: i % 2 === 0 ? C.mint : C.pink,
                  }}
                />
              </div>
            </div>
          </div>
        ))}
        {sources.length === 0 && <p className="text-dash-muted text-xs">이 구간에는 로그가 없습니다.</p>}
      </div>
    </Card>
  );
}

function ErrorRateGauge({ events }) {
  const errorCount = events.filter((l) => ERROR_BAND.includes(l.level)).length;
  const rate = events.length ? Math.round((errorCount / events.length) * 1000) / 10 : 0;
  const data = [{ value: rate }, { value: 100 - rate }];

  return (
    <Card title="Error Rate" subtitle="Emergency~Major 비중" className="relative">
      <ResponsiveContainer width="100%" height={140}>
        <PieChart>
          <Pie
            data={data}
            startAngle={180}
            endAngle={0}
            innerRadius={55}
            outerRadius={72}
            dataKey="value"
            stroke="none"
          >
            <Cell fill="#F2617A" />
            <Cell fill={C.surfaceAlt} />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-x-0 bottom-6 flex flex-col items-center">
        <span className="text-white text-2xl font-semibold">{rate}%</span>
        <span className="text-dash-muted text-xs">
          {errorCount} / {events.length} logs
        </span>
      </div>
    </Card>
  );
}

function RecentLogsTable({ events }) {
  const [query, setQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState("ALL");

  const filtered = useMemo(() => {
    return events.filter((l) => {
      const matchesLevel = levelFilter === "ALL" || l.level === levelFilter;
      const q = query.trim().toLowerCase();
      const matchesQuery =
        q === "" || l.message.toLowerCase().includes(q) || l.source.toLowerCase().includes(q);
      return matchesLevel && matchesQuery;
    });
  }, [events, query, levelFilter]);

  return (
    <Card
      title="Recent Logs"
      subtitle={`Showing ${Math.min(filtered.length, 8)} of ${filtered.length}`}
      action={
        <div className="flex flex-wrap gap-1 max-w-md">
          <button
            onClick={() => setLevelFilter("ALL")}
            className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
              levelFilter === "ALL" ? "bg-dash-surfaceAlt text-white" : "text-dash-muted hover:text-white"
            }`}
          >
            All
          </button>
          {ALL_LEVELS.filter((l) => l.key !== "UNKNOWN").map((l) => (
            <button
              key={l.key}
              onClick={() => setLevelFilter(l.key)}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                levelFilter === l.key ? "bg-dash-surfaceAlt text-white" : "text-dash-muted hover:text-white"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      }
    >
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter by message or source..."
        className="w-full bg-dash-bg text-sm text-white placeholder-dash-muted rounded-lg px-3 py-2 mb-3 outline-none focus:ring-1 focus:ring-dash-mint"
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-dash-muted text-xs uppercase tracking-wide">
              <th className="text-left font-medium pb-2">Time</th>
              <th className="text-left font-medium pb-2">Level</th>
              <th className="text-left font-medium pb-2">Source</th>
              <th className="text-left font-medium pb-2">Message</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 8).map((log) => (
              <tr key={log.id} className="border-t border-dash-surfaceAlt">
                <td className="py-2.5 text-dash-faint whitespace-nowrap pr-4">
                  {log.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </td>
                <td className="py-2.5 pr-4">
                  <LevelBadge level={log.level} />
                </td>
                <td className="py-2.5 text-white pr-4 whitespace-nowrap">{log.source}</td>
                <td className="py-2.5 text-dash-faint">{log.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="text-dash-muted text-xs py-3">조건에 맞는 로그가 없습니다.</p>}
      </div>
    </Card>
  );
}

// ---------- content (embeddable) ----------

// Main content only — no Sidebar/Topbar. Exported separately so this can be
// embedded as the "Overview" tab inside a larger app shell (see App.jsx).
// A single range selector (see timeSeries.js RANGE_PRESETS) drives every
// panel here, the same way a Grafana dashboard's time-range picker does.
export function DashboardContent() {
  const [rangeKey, setRangeKey] = useState("24h");
  const preset = RANGE_PRESETS.find((p) => p.key === rangeKey);

  const rangeEvents = useMemo(() => {
    const cutoff = MOCK_NOW.getTime() - preset.lookbackMs;
    return RAW_EVENTS.filter((e) => e.timestamp.getTime() > cutoff);
  }, [rangeKey]);

  const errorCount = rangeEvents.filter((l) => ERROR_BAND.includes(l.level)).length;
  const warnCount = rangeEvents.filter((l) => WARN_BAND.includes(l.level)).length;
  const sourceCount = new Set(rangeEvents.map((l) => l.source)).size;
  const rangeSources = topSourcesFor(rangeEvents);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4">
        <KpiCard label={`Total Logs (${preset.label})`} value={rangeEvents.length} delta="8%" positive />
        <KpiCard label="Errors (Emergency~Major)" value={errorCount} delta="12%" positive={false} />
        <KpiCard label="Warnings (Minor~Warning)" value={warnCount} delta="4%" positive />
        <KpiCard label="Active Sources" value={sourceCount} delta="2 new" positive />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <LogVolumeChart rangeKey={rangeKey} onRangeChange={setRangeKey} />
        </div>
        <LevelDistributionChart events={rangeEvents} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <RecentLogsTable events={rangeEvents} />
        </div>
        <div className="space-y-6">
          <TopSources sources={rangeSources} />
          <ErrorRateGauge events={rangeEvents} />
        </div>
      </div>
    </div>
  );
}

// Standalone version (own Sidebar + Topbar) — kept for running this file by itself.
export default function LogDashboard() {
  return (
    <div className="flex min-h-screen bg-dash-bg font-sans">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Topbar />
        <main className="flex-1 p-6">
          <DashboardContent />
        </main>
      </div>
    </div>
  );
}
