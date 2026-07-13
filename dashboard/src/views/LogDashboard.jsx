import React, { useMemo, useState, useEffect, useRef, Suspense, lazy } from "react";
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
  ReferenceDot,
  PieChart,
  Pie,
  Cell,
  Sector,
} from "recharts";
import { latencyStatsFor, levelDistributionFor } from "../data/mockLogs";
import { useTopIps } from "../hooks/useTopIps";
import { useKpi } from "../hooks/useKpi";
import { useLogVolume } from "../hooks/useLogVolume";
import { useLogLevels } from "../hooks/useLogLevels";
import { useDetectionSources } from "../hooks/useDetectionSources";
import { useLogs } from "../hooks/useLogs";
import { REAL_SEVERITY_LEVELS, REAL_ERROR_MIN_SEVERITY, REAL_WARNING_SEVERITY } from "../data/realSeverity";
import { getModuleMeta } from "../data/moduleMeta";
import { ALL_LEVELS, ERROR_BAND, WARN_BAND, getLevelMeta, getDisplayTier } from "../data/logLevels";
import { RANGE_PRESETS, formatBucketLabel, detectSpike } from "../data/timeSeries";
import { CHART_COLORS, forTheme } from "../data/theme";
import { useTheme } from "../hooks/useTheme";
import SearchDiscoverView from "./SearchDiscoverView";
import WorldMap from "../components/WorldMap";
// three.js는 이 카드에서만 쓰이는데도 LogDashboard.jsx가 Card/KpiCard 등 공용
// 프리미티브를 export하다보니 다른 뷰(WAS/Falco/K8sAudit/Incidents)들이 전부 이
// 파일을 import한다 — 정적 import로 넣으면 그 뷰들 번들에도 300~400KB가 얹혀버려서
// dynamic import + Suspense로 분리(코드 스플리팅), Overview가 실제로 렌더될 때만
// 별도 청크로 로드되게 한다.
const Globe3D = lazy(() => import("../components/Globe3D"));
import { useGeoStats } from "../hooks/useGeoStats";

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
        <span className="text-dash-fg font-semibold tracking-tight">LogBoard</span>
      </div>

      <nav className="flex-1 space-y-1">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.label}
            className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
              item.active
                ? "bg-dash-surface text-dash-fg"
                : "text-dash-muted hover:bg-dash-surface/60 hover:text-dash-fg"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="pt-4 border-t border-dash-surfaceAlt space-y-1">
        <button className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-dash-muted hover:text-dash-fg">
          Favorites
        </button>
        <button className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-dash-muted hover:text-dash-fg">
          History
        </button>
        <button className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-dash-muted hover:text-dash-fg">
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
          className="w-full bg-dash-surface text-sm text-dash-fg placeholder-dash-muted rounded-lg px-4 py-2 outline-none focus:ring-1 focus:ring-dash-mint"
        />
      </div>
      <div className="flex items-center gap-2 ml-auto text-dash-muted text-sm">
        <span className="w-2 h-2 rounded-full bg-dash-pink inline-block" />
        <span>3 active alerts</span>
      </div>
      <div className="w-9 h-9 rounded-full bg-dash-surfaceAlt flex items-center justify-center text-dash-fg text-sm">
        용
      </div>
    </header>
  );
}

export function Card({ title, subtitle, action, children, className = "" }) {
  return (
    <div className={`bg-dash-surface rounded-2xl p-5 ${className}`}>
      {(title || action) && (
        <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
          <div>
            {title && <h3 className="text-dash-fg text-sm font-semibold">{title}</h3>}
            {subtitle && <p className="text-dash-muted text-xs mt-0.5">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

// Doubles as a filter toggle when `onClick` is passed (Overview/Incidents KPI
// rows) — active state gets a neon ring so it reads as "currently selected",
// not just another static stat card.
export function KpiCard({ label, value, delta, positive = true, onClick, active = false, accent = "mint" }) {
  const Tag = onClick ? "button" : "div";
  const accentClass = accent === "critical" ? "glow-box-critical" : "glow-box-mint";
  const displayValue = useCountUp(value);
  return (
    <Tag
      onClick={onClick}
      className={`bg-dash-surface rounded-2xl p-5 flex-1 min-w-[160px] text-left transition-shadow ${
        onClick ? "cursor-pointer hover:bg-dash-surfaceAlt/60" : ""
      } ${active ? accentClass : ""}`}
    >
      <p className="text-dash-muted text-xs mb-2">{label}</p>
      <p className="text-dash-fg text-2xl font-semibold tabular-nums">{displayValue}</p>
      {delta && (
        <p className={`text-xs mt-1 ${positive ? "text-dash-mint" : "text-dash-pink"}`}>
          {positive ? "▲" : "▼"} {delta} vs 이전 구간
        </p>
      )}
    </Tag>
  );
}

// 라벨 텍스트는 정밀한 9단계 값을 그대로 보여주고(MAJOR, NOTICE...), 색상만
// getDisplayTier의 4개 시맨틱 버킷(Error/Warn/Info/Debug)으로 뭉쳐서 스캔하기
// 쉽게 — 데이터 정밀도는 유지하면서 색상 종류만 줄이는 절충.
function LevelBadge({ level }) {
  const { theme } = useTheme();
  const meta = getLevelMeta(level);
  const tier = getDisplayTier(level);
  const color = forTheme(tier.color, theme);
  return (
    <span
      className="text-xs font-medium px-2 py-1 rounded-md whitespace-nowrap"
      style={{ color, backgroundColor: `${color}22` }}
      title={`${tier.label} tier`}
    >
      {meta.label}
    </span>
  );
}

// ---------- charts ----------

// Time range is picked once, in the search bar at the top of the page
// (SearchDiscoverView's TimeRangePicker) — this chart just reads rangeKey.
// GET /stats/volume(servers/platform-api/app/stats_api.py) 연동 — 서버가
// date_histogram으로 버킷을 미리 잘라서 내려주면, 라벨 포맷(timeSeries.js의
// formatBucketLabel)과 급증 탐지(detectSpike)는 그대로 클라이언트에서 재사용.
export function LogVolumeChart({ rangeKey, module }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const preset = RANGE_PRESETS.find((p) => p.key === rangeKey);
  const { buckets, status, error } = useLogVolume({
    lookbackMs: preset.lookbackMs,
    bucketMs: preset.bucketMs,
    module,
  });

  const data = useMemo(
    () =>
      buckets.map((b) => ({
        label: formatBucketLabel(new Date(b.ts), preset.bucketMs),
        total: b.total,
        errorish: b.errors,
      })),
    [buckets, rangeKey]
  );

  // 평소(중앙값) 대비 급증 구간 탐지 — 있으면 배지 + 차트 위 마커로 표시.
  const spike = useMemo(() => detectSpike(data.map((d) => d.total)), [data]);
  const spikePoint = spike ? data[spike.index] : null;

  return (
    <Card
      title="Log Volume"
      subtitle={`Last ${preset.label} · ${data.length} buckets`}
      action={
        spike && (
          <span className="text-[11px] font-medium px-2 py-1 rounded-md bg-dash-pink/15 text-dash-pink whitespace-nowrap">
            ⚠ {spikePoint.label} 평소 대비 +{spike.pctOverBaseline}% 급증
          </span>
        )
      }
      className="h-80"
    >
      {status === "loading" && <p className="text-dash-muted text-xs">불러오는 중...</p>}
      {status === "error" && <p className="text-dash-critical text-xs">{error}</p>}
      {status === "ready" && (
        <>
          <ResponsiveContainer width="100%" height="82%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="volumeFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.mint} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={C.mint} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="errorFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.critical} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={C.critical} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={C.surfaceAlt} vertical={false} />
              <XAxis dataKey="label" stroke={C.muted} tickLine={false} axisLine={false} fontSize={11} minTickGap={24} />
              <YAxis stroke={C.muted} tickLine={false} axisLine={false} fontSize={12} />
              <Tooltip contentStyle={{ background: C.surfaceAlt, border: "none", borderRadius: 8, color: C.fg }} />
              <Area type="monotone" dataKey="total" stroke={C.mint} fill="url(#volumeFill)" strokeWidth={2} />
              <Area type="monotone" dataKey="errorish" stroke={C.critical} fill="url(#errorFill)" strokeWidth={2} />
              {spikePoint && (
                <ReferenceDot
                  x={spikePoint.label}
                  y={spikePoint.total}
                  r={5}
                  fill={C.pink}
                  stroke={C.bg}
                  strokeWidth={2}
                  ifOverflow="extendDomain"
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
          <div className="flex gap-4 text-xs text-dash-muted mt-2">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-dash-mint inline-block" /> 전체 로그
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: C.critical }} /> Major~Critical
            </span>
            {spike && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-dash-pink inline-block" /> 급증 구간 (기준선 {spike.baseline}건)
              </span>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

// Log Levels 차트 실데이터 버전 — event.severity 1~4 그대로 4개 막대(기존
// LevelDistributionChart의 9단계는 FalcoView 등 여전히 mock인 다른 뷰가
// 재사용 중이라 그대로 두고, Overview 전용으로 새로 뺐다).
export function RealLevelDistributionChart({ hours, module }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const { levels, total, status, error } = useLogLevels({ hours, module });

  const data = REAL_SEVERITY_LEVELS.map((l) => {
    const found = levels.find((x) => x.severity === l.severity);
    return { key: l.key, level: l.label, count: found ? found.count : 0, color: forTheme(l.color, theme) };
  });

  return (
    <Card title="Log Levels" subtitle={status === "ready" ? `선택 구간 · ${total}건` : "불러오는 중..."} className="h-80">
      {status === "error" && <p className="text-dash-critical text-xs">{error}</p>}
      {status !== "error" && (
        <ResponsiveContainer width="100%" height="88%">
          <BarChart data={data} margin={{ bottom: 16 }}>
            <CartesianGrid stroke={C.surfaceAlt} vertical={false} />
            <XAxis dataKey="level" stroke={C.muted} tickLine={false} axisLine={false} fontSize={11} interval={0} />
            <YAxis stroke={C.muted} tickLine={false} axisLine={false} fontSize={12} />
            <Tooltip contentStyle={{ background: C.surfaceAlt, border: "none", borderRadius: 8, color: C.fg }} />
            <Bar dataKey="count" radius={[6, 6, 0, 0]} isAnimationActive animationDuration={700} animationEasing="ease-out">
              {data.map((d) => (
                <Cell key={d.key} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

export function LevelDistributionChart({ events }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const dist = levelDistributionFor(events);
  const data = ALL_LEVELS.filter((l) => l.key !== "UNKNOWN" || dist.UNKNOWN).map((l) => ({
    key: l.key,
    level: l.label,
    count: dist[l.key] || 0,
    color: forTheme(l.color, theme),
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
          <Tooltip contentStyle={{ background: C.surfaceAlt, border: "none", borderRadius: 8, color: C.fg }} />
          <Bar dataKey="count" radius={[6, 6, 0, 0]} isAnimationActive animationDuration={700} animationEasing="ease-out">
            {data.map((d) => (
              <Cell key={d.key} fill={d.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

// GET /stats/top-ips 연동 이후로 "소스"는 서비스 이름이 아니라 공격 발원지
// IP다. status/error가 오면(useTopIps) 로딩/에러 문구를 보여주고, 안 넘어오면
// (다른 호출부가 여전히 즉시 계산된 배열을 넘기는 경우) 예전처럼 바로 렌더.
export function TopSources({ sources, limit = 5, highlighted = false, status = "ready", error = null }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const max = sources[0]?.count || 1;
  return (
    <Card
      title="Top Source IPs"
      subtitle={highlighted ? `전체 ${sources.length}개 IP` : "선택 구간 기준"}
      className={highlighted ? "glow-box-mint" : ""}
    >
      <div className="space-y-3">
        {status === "loading" && <p className="text-dash-muted text-xs">불러오는 중...</p>}
        {status === "error" && (
          <p className="text-dash-critical text-xs">{error || "데이터를 불러오지 못했습니다."}</p>
        )}
        {status !== "loading" &&
          status !== "error" &&
          sources.slice(0, limit).map((s, i) => (
            <div key={s.name} className="flex items-center gap-3">
              <span className="text-dash-muted text-xs w-4">{String(i + 1).padStart(2, "0")}</span>
              <div className="flex-1">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-dash-fg font-mono">{s.name}</span>
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
        {status !== "loading" && status !== "error" && sources.length === 0 && (
          <p className="text-dash-muted text-xs">이 구간에는 로그가 없습니다.</p>
        )}
      </div>
    </Card>
  );
}

export function ErrorRateGauge({ events, title = "Error Rate", subtitle = "Emergency~Major 비중", unitLabel = "logs" }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const errorCount = events.filter((l) => ERROR_BAND.includes(l.level)).length;
  const rate = events.length ? Math.round((errorCount / events.length) * 1000) / 10 : 0;
  const data = [{ value: rate }, { value: 100 - rate }];
  const displayRate = useCountUp(`${rate}%`);

  return (
    <Card title={title} subtitle={subtitle} className="relative">
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
            isAnimationActive
            animationDuration={800}
            animationEasing="ease-out"
          >
            <Cell fill={C.critical} />
            <Cell fill={C.surfaceAlt} />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-x-0 bottom-6 flex flex-col items-center">
        <span
          className={`text-dash-fg text-2xl font-semibold tabular-nums ${rate > 0 ? "animate-pulse glow-critical" : ""}`}
        >
          {displayRate}
        </span>
        <span className="text-dash-muted text-xs">
          {errorCount} / {events.length} {unitLabel}
        </span>
      </div>
    </Card>
  );
}

function tooltipStyle(C) {
  return { background: C.surfaceAlt, border: "none", borderRadius: 8, color: C.fg, fontSize: 12 };
}

// 지구본의 자동 회전처럼, 도넛 차트도 가만히 있지 않고 조각을 하나씩 순회하며
// 스포트라이트를 비춰준다 — 사용자가 호버하면 그 순간엔 자동 순환을 멈춘다.
function useAutoCycleIndex(length, intervalMs = 2200) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!length) return;
    if (index >= length) setIndex(0);
  }, [length]);
  useEffect(() => {
    if (!length || paused) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % length), intervalMs);
    return () => clearInterval(t);
  }, [length, paused, intervalMs]);
  return [index, setPaused];
}

// 활성 조각을 살짝 키우고 바깥에 얇은 발광 링을 둘러서 "스포트라이트가 훑고
// 지나간다"는 느낌을 준다.
function renderGlowActiveShape(props) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
  return (
    <g>
      <Sector cx={cx} cy={cy} innerRadius={innerRadius} outerRadius={outerRadius + 5} startAngle={startAngle} endAngle={endAngle} fill={fill} />
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={outerRadius + 7}
        outerRadius={outerRadius + 10}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        opacity={0.35}
      />
    </g>
  );
}

// KPI 숫자가 값이 바뀔 때마다 스르륵 카운트업 — 필터 버튼을 누르거나 구간을
// 바꿀 때 화면이 "반응하고 있다"는 걸 보여주는 작은 생동감 장치. 콤마가 섞인
// 문자열("1,234")도 파싱해서 애니메이션하고, 숫자가 아닌 값("GET (42)" 같은
// delta 라벨)은 애니메이션 없이 그대로 통과시킨다.
function useCountUp(rawValue, duration = 500) {
  const [display, setDisplay] = useState(rawValue);
  const fromRef = useRef(0);
  const rafRef = useRef(null);

  useEffect(() => {
    const numeric = typeof rawValue === "number" ? rawValue : parseFloat(String(rawValue).replace(/,/g, ""));
    const isPlainNumber = !Number.isNaN(numeric) && String(rawValue).trim() === String(rawValue).replace(/,/g, "").trim() || /^[\d,]+(\.\d+)?%?$/.test(String(rawValue).trim());
    if (Number.isNaN(numeric) || !isPlainNumber) {
      setDisplay(rawValue);
      return;
    }
    const suffix = String(rawValue).trim().endsWith("%") ? "%" : "";
    const hasComma = String(rawValue).includes(",");
    const start = fromRef.current;
    const startTime = performance.now();
    cancelAnimationFrame(rafRef.current);
    function tick(now) {
      const p = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = start + (numeric - start) * eased;
      const rounded = Number.isInteger(numeric) ? Math.round(val) : Math.round(val * 10) / 10;
      setDisplay((hasComma ? rounded.toLocaleString() : String(rounded)) + suffix);
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = numeric;
      }
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawValue]);

  return display;
}

// 탐지 소스별(WAS/Falco/K8s Audit) 도넛 — 3계층 상관분석 프로젝트의 핵심 축이라
// Overview 요약에도 반드시 있어야 하는 지표. GET /stats(by_module) 연동 - WAF는
// 비활성화 상태라 보통 안 잡히거나 0건(정상).
function DetectionSourceDonutCompact({ lookbackMs }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const { byModule, status, error } = useDetectionSources({ lookbackMs });
  const data = useMemo(
    () =>
      byModule
        .filter((d) => d.count > 0)
        .map((d) => {
          const meta = getModuleMeta(d.module);
          return { key: d.module, count: d.count, label: meta.label, color: forTheme(meta.color, theme) };
        }),
    [byModule, theme]
  );
  const total = data.reduce((s, d) => s + d.count, 0);
  const [activeIndex, setPaused] = useAutoCycleIndex(data.length);

  return (
    <Card title="탐지 소스별 분포" subtitle={status === "ready" ? `WAS / Falco / K8s Audit · 총 ${total}건` : "불러오는 중..."}>
      {status === "error" && <p className="text-dash-critical text-xs">{error}</p>}
      {status === "ready" && data.length === 0 && <p className="text-dash-muted text-xs">이 구간에는 로그가 없습니다.</p>}
      {data.length > 0 && (
        <div className="flex items-center gap-4">
          <ResponsiveContainer width={110} height={110}>
            <PieChart onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
              <Pie
                data={data}
                dataKey="count"
                nameKey="label"
                innerRadius={32}
                outerRadius={52}
                stroke="none"
                isAnimationActive
                animationDuration={700}
                animationEasing="ease-out"
                activeIndex={activeIndex}
                activeShape={renderGlowActiveShape}
              >
                {data.map((d) => (
                  <Cell key={d.key} fill={d.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle(C)} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 space-y-1.5 text-xs">
            {data.map((d, i) => (
              <div
                key={d.key}
                className={`flex items-center justify-between gap-2 rounded-md px-1 -mx-1 py-0.5 transition-colors ${
                  i === activeIndex ? "bg-dash-surfaceAlt/60" : ""
                }`}
              >
                <span className={`flex items-center gap-1.5 truncate ${i === activeIndex ? "text-dash-fg" : "text-dash-muted"}`}>
                  <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ backgroundColor: d.color }} />
                  {d.label}
                </span>
                <span className="text-dash-fg">{d.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// 공격 발원지 요약 — Infrastructure 탭엔 자세히 훑어보는 평면 WorldMap이 이미
// 있어서, Overview는 같은 데이터(GET /stats/geo)를 회전하는 3D 지구본으로
// 보여주는 쪽을 택함 — 랜딩 화면의 "화려한" 대표 비주얼 역할. 자세히 보려면
// Infrastructure 탭으로.
//
// 주의: enrichment.py의 GeoIP lookup이 아직 모든 IP를 "KR/Seoul"로 고정
// 반환하는 더미라, MaxMind DB가 붙기 전까진 지구본에 한반도 쪽 점만 두드러질
// 수 있다 — 팀원 확인 필요(useGeoStats.js 주석 참고).
function GeoSummaryCard() {
  const { theme } = useTheme();
  const { countries, status, error } = useGeoStats({ limit: 10 });
  const total = countries.reduce((s, c) => s + c.count, 0);

  return (
    <Card title="공격 발원지 (GeoIP) · 3D" subtitle={`전체 기간 · ${countries.length}개국 · 총 ${total}건 · 드래그로 회전`}>
      {status === "error" && <p className="text-dash-critical text-xs mb-2">{error}</p>}
      <div className="h-80">
        <Suspense fallback={<div className="w-full h-full flex items-center justify-center text-dash-faint text-xs">지구본 로딩 중...</div>}>
          <Globe3D points={countries} theme={theme} />
        </Suspense>
      </div>
    </Card>
  );
}

// quantile_over_time 계열 통계 — 응답시간(durationMs) p50/p90/p99 + avg/max.
// SOC 대시보드에서 신뢰도를 높여주는 "API 레이턴시 p99" 패널.
// 개별 셀 컴포넌트로 분리한 이유: rows 배열 길이가 stats 유무에 따라 0 또는 5로
//바뀔 수 있어서, .map() 안에서 직접 useCountUp을 호출하면 렌더마다 훅 호출
// 횟수가 달라져 Rules of Hooks를 위반한다 — 컴포넌트 단위로 쪼개면 각자 자기
// 인스턴스의 훅만 관리하므로 안전하다.
function LatencyStatValue({ value, tone }) {
  const display = useCountUp(value);
  return <p className={`text-sm font-semibold ${tone}`}>{display}ms</p>;
}

export function LatencyStatsPanel({ events }) {
  const stats = useMemo(() => latencyStatsFor(events), [events]);

  const rows = stats
    ? [
        { label: "p50", value: stats.p50, tone: "text-dash-fg" },
        { label: "p90", value: stats.p90, tone: "text-dash-fg" },
        { label: "p99", value: stats.p99, tone: "text-dash-pink" },
        { label: "avg", value: stats.avg, tone: "text-dash-muted" },
        { label: "max", value: stats.max, tone: "text-dash-muted" },
      ]
    : [];

  return (
    <Card title="API Latency" subtitle={stats ? `선택 구간 · ${stats.count.toLocaleString()}건 기준` : "데이터 없음"}>
      {stats ? (
        <div className="grid grid-cols-5 gap-2">
          {rows.map((r) => (
            <div key={r.label} className="bg-dash-bg rounded-xl p-3 text-center">
              <p className="text-dash-muted text-[10px] uppercase tracking-wide mb-1">{r.label}</p>
              <LatencyStatValue value={r.value} tone={r.tone} />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-dash-muted text-xs">이 구간에는 로그가 없습니다.</p>
      )}
    </Card>
  );
}

// filterLevels: 상단 레벨 필터 버튼 행에 보여줄 레벨 목록 — 기본은 9단계
// mock 전체(ALL_LEVELS)지만, 실데이터(severity 1~4)를 넘길 땐 REAL_SEVERITY_LEVELS
// 처럼 4개만 넘겨서 "눌러도 항상 0건"인 나머지 5개 버튼이 안 보이게 한다.
// status/error: useLogs 같은 비동기 훅과 바로 연결할 수 있게 한 선택적 로딩/에러 표시.
export function RecentLogsTable({ events, filterLevels, status = "ready", error = null }) {
  const [query, setQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState("ALL");
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [expandedId, setExpandedId] = useState(null);
  const levelButtons = filterLevels ?? ALL_LEVELS.filter((l) => l.key !== "UNKNOWN");

  const sourceOptions = useMemo(
    () => Array.from(new Set(events.map((l) => l.source))).sort(),
    [events]
  );

  // AND 조합: 레벨 AND 소스 AND 키워드 — 셋 다 만족하는 로그만 남김.
  const filtered = useMemo(() => {
    return events.filter((l) => {
      const matchesLevel = levelFilter === "ALL" || l.level === levelFilter;
      const matchesSource = sourceFilter === "ALL" || l.source === sourceFilter;
      const q = query.trim().toLowerCase();
      const matchesQuery =
        q === "" || l.message.toLowerCase().includes(q) || l.source.toLowerCase().includes(q);
      return matchesLevel && matchesSource && matchesQuery;
    });
  }, [events, query, levelFilter, sourceFilter]);

  return (
    <Card
      title="Recent Logs"
      subtitle={`Showing ${Math.min(filtered.length, 8)} of ${filtered.length}`}
      action={
        <div className="flex flex-wrap gap-1 max-w-md">
          <button
            onClick={() => setLevelFilter("ALL")}
            className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
              levelFilter === "ALL" ? "bg-dash-surfaceAlt text-dash-fg" : "text-dash-muted hover:text-dash-fg"
            }`}
          >
            All
          </button>
          {levelButtons.map((l) => (
            <button
              key={l.key}
              onClick={() => setLevelFilter(l.key)}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                levelFilter === l.key ? "bg-dash-surfaceAlt text-dash-fg" : "text-dash-muted hover:text-dash-fg"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      }
    >
      {status === "loading" && <p className="text-dash-muted text-xs py-3">불러오는 중...</p>}
      {status === "error" && <p className="text-dash-critical text-xs py-3">{error || "로그를 불러오지 못했습니다."}</p>}
      {status === "ready" && (
      <>
      <div className="flex flex-wrap gap-2 mb-3">
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="bg-dash-bg text-sm text-dash-fg rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-dash-mint"
        >
          <option value="ALL">모든 소스</option>
          {sourceOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by message or source..."
          className="flex-1 min-w-[200px] bg-dash-bg text-sm text-dash-fg placeholder-dash-muted rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-dash-mint"
        />
      </div>
      {(levelFilter !== "ALL" || sourceFilter !== "ALL" || query.trim() !== "") && (
        <p className="text-dash-faint text-[11px] -mt-2 mb-3">
          조건:{" "}
          {[
            levelFilter !== "ALL" && `레벨=${levelFilter}`,
            sourceFilter !== "ALL" && `소스=${sourceFilter}`,
            query.trim() !== "" && `키워드="${query.trim()}"`,
          ]
            .filter(Boolean)
            .join(" AND ")}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-dash-muted text-xs uppercase tracking-wide">
              <th className="text-left font-medium pb-2 w-4"></th>
              <th className="text-left font-medium pb-2">Time</th>
              <th className="text-left font-medium pb-2">Level</th>
              <th className="text-left font-medium pb-2">Source</th>
              <th className="text-left font-medium pb-2">Message</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 8).map((log) => {
              const isOpen = expandedId === log.id;
              return (
                <React.Fragment key={log.id}>
                  <tr
                    onClick={() => setExpandedId(isOpen ? null : log.id)}
                    className="border-t border-dash-surfaceAlt cursor-pointer hover:bg-dash-surfaceAlt/40"
                  >
                    <td className="py-2.5 text-dash-faint text-xs w-4">{isOpen ? "▾" : "▸"}</td>
                    <td className="py-2.5 text-dash-faint whitespace-nowrap pr-4">
                      {log.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="py-2.5 pr-4">
                      <LevelBadge level={log.level} />
                    </td>
                    <td className="py-2.5 text-dash-fg pr-4 whitespace-nowrap">{log.source}</td>
                    <td className="py-2.5 text-dash-faint">{log.message}</td>
                  </tr>
                  {isOpen && (
                    <tr className="border-t border-dash-surfaceAlt bg-dash-bg/60">
                      <td colSpan={5} className="py-3 px-2">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-xs">
                          <div>
                            <p className="text-dash-faint mb-0.5">전체 시각</p>
                            <p className="text-dash-fg">{log.timestamp.toLocaleString("ko-KR")}</p>
                          </div>
                          <div>
                            <p className="text-dash-faint mb-0.5">경로</p>
                            <p className="text-dash-fg font-mono">{log.path}</p>
                          </div>
                          <div>
                            <p className="text-dash-faint mb-0.5">응답시간</p>
                            <p className="text-dash-fg">{log.durationMs}ms</p>
                          </div>
                          <div>
                            <p className="text-dash-faint mb-0.5">소스</p>
                            <p className="text-dash-fg">{log.source}</p>
                          </div>
                          <div>
                            <p className="text-dash-faint mb-0.5">Namespace / Pod</p>
                            <p className="text-dash-fg">
                              {log.namespace}/{log.pod}
                            </p>
                          </div>
                          <div>
                            <p className="text-dash-faint mb-0.5">Container</p>
                            <p className="text-dash-fg">{log.container}</p>
                          </div>
                          <div>
                            <p className="text-dash-faint mb-0.5">Node</p>
                            <p className="text-dash-fg">{log.node}</p>
                          </div>
                          <div>
                            <p className="text-dash-faint mb-0.5">Image</p>
                            <p className="text-dash-fg font-mono truncate" title={log.image}>
                              {log.image}
                            </p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="text-dash-muted text-xs py-3">조건에 맞는 로그가 없습니다.</p>}
      </div>
      </>
      )}
    </Card>
  );
}

// ---------- content (embeddable) ----------

// Main content only — no Sidebar/Topbar. Exported separately so this can be
// embedded as the "Overview" tab inside a larger app shell (see App.jsx).
// A single range selector (see timeSeries.js RANGE_PRESETS) drives every
// panel here, the same way a Grafana dashboard's time-range picker does.
// KPI 카드 4개 모두 라디오 버튼처럼 동작 — 눌러서 전체/에러만/경고만으로 아래
// 차트·테이블을 필터링한다. SOURCES는 레벨 자체를 걸러내진 않지만(소스는 레벨
// 개념이 아니라서), 대신 Top Sources 카드를 펼쳐서 더 많은 소스를 보여준다.
// min_severity: /logs가 지원하는 ">=" 조건. WARNING(정확히 severity 2)만 서버
// 쪽에서 못 걸러서 클라이언트에서 한 번 더 좁힌다(아래 displayEvents).
const KPI_MIN_SEVERITY = {
  ALL: undefined,
  ERROR: REAL_ERROR_MIN_SEVERITY,
  WARNING: REAL_WARNING_SEVERITY,
  SOURCES: undefined,
};

export function DashboardContent() {
  const [rangeKey, setRangeKey] = useState("24h");
  const [kpiFilter, setKpiFilter] = useState("ALL");
  // 검색 결과 패널 펼침 여부 — SearchDiscoverView 안의 "N hits" 배지뿐 아니라
  // 그 아래(= Total Logs KPI 행 위)에 놓는 전용 버튼으로도 열고 닫을 수 있게
  // 여기서 소유하고 내려보낸다.
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [searchHits, setSearchHits] = useState(0);
  const preset = RANGE_PRESETS.find((p) => p.key === rangeKey);
  const hours = preset.lookbackMs / (60 * 60 * 1000);

  // GET /stats/kpi — 상단 4개 KPI 카드(Total/Errors/Warnings/Active Sources +
  // 이전 구간 대비 델타).
  const { data: kpi, status: kpiStatus } = useKpi({ hours });

  // GET /logs — 아래 차트/테이블에 실제로 흘려보내는 이벤트. kpiFilter에 따라
  // min_severity로 서버에서 미리 좁혀서 요청.
  const { logs: rawLogs, status: logsStatus, error: logsError } = useLogs({
    lookbackMs: preset.lookbackMs,
    minSeverity: KPI_MIN_SEVERITY[kpiFilter],
    limit: 300,
  });
  const displayEvents = useMemo(
    () => (kpiFilter === "WARNING" ? rawLogs.filter((e) => e.severity === REAL_WARNING_SEVERITY) : rawLogs),
    [rawLogs, kpiFilter]
  );
  const wasEventsForLatency = useMemo(() => displayEvents.filter((e) => e.module === "was"), [displayEvents]);

  // GET /stats/top-ips — 실제 백엔드 집계. kpiFilter가 SOURCES면 더 많이(limit
  // 10) 보여주므로 그만큼 넉넉히 요청.
  const { items: topIps, status: topIpsStatus, error: topIpsError } = useTopIps({
    lookbackMs: preset.lookbackMs,
    limit: kpiFilter === "SOURCES" ? 10 : 5,
  });

  return (
    <div className="space-y-6">
      <SearchDiscoverView
        rangeKey={rangeKey}
        onRangeChange={setRangeKey}
        expanded={searchExpanded}
        setExpanded={setSearchExpanded}
        onResultsCountChange={setSearchHits}
      />

      <button
        onClick={() => setSearchExpanded((e) => !e)}
        className="w-full flex items-center justify-between gap-3 bg-dash-surface hover:bg-dash-surfaceAlt/60 rounded-xl px-4 py-2.5 text-xs transition-colors"
      >
        <span className="flex items-center gap-2 text-dash-muted">
          <span className="text-dash-fg font-semibold">{searchHits.toLocaleString()} hits</span>
          검색 결과 패널 {searchExpanded ? "접기" : "펼치기"}
        </span>
        <span className="text-dash-faint">{searchExpanded ? "▴" : "▾"}</span>
      </button>

      <div className="flex flex-wrap gap-4">
        <KpiCard
          label={`Total Logs (${preset.label})`}
          value={kpiStatus === "ready" ? kpi.current.total : "-"}
          delta={kpiStatus === "ready" && kpi.delta_pct.total != null ? `${Math.abs(kpi.delta_pct.total)}%` : undefined}
          positive={kpiStatus === "ready" ? (kpi.delta_pct.total ?? 0) >= 0 : true}
          onClick={() => setKpiFilter("ALL")}
          active={kpiFilter === "ALL"}
        />
        <KpiCard
          label="Errors (Major~Critical)"
          value={kpiStatus === "ready" ? kpi.current.errors : "-"}
          delta={kpiStatus === "ready" && kpi.delta_pct.errors != null ? `${Math.abs(kpi.delta_pct.errors)}%` : undefined}
          positive={kpiStatus === "ready" ? (kpi.delta_pct.errors ?? 0) <= 0 : false}
          onClick={() => setKpiFilter("ERROR")}
          active={kpiFilter === "ERROR"}
          accent="critical"
        />
        <KpiCard
          label="Warnings (Minor)"
          value={kpiStatus === "ready" ? kpi.current.warnings : "-"}
          delta={kpiStatus === "ready" && kpi.delta_pct.warnings != null ? `${Math.abs(kpi.delta_pct.warnings)}%` : undefined}
          positive={kpiStatus === "ready" ? (kpi.delta_pct.warnings ?? 0) <= 0 : true}
          onClick={() => setKpiFilter("WARNING")}
          active={kpiFilter === "WARNING"}
        />
        <KpiCard
          label="Active Sources"
          value={kpiStatus === "ready" ? kpi.current.sources : "-"}
          delta={kpiStatus === "ready" && kpi.sources_delta !== 0 ? `${kpi.sources_delta > 0 ? "+" : ""}${kpi.sources_delta} new` : undefined}
          positive={kpiStatus === "ready" ? kpi.sources_delta >= 0 : true}
          onClick={() => setKpiFilter("SOURCES")}
          active={kpiFilter === "SOURCES"}
        />
      </div>
      {kpiFilter !== "ALL" && (
        <p className="text-dash-faint text-[11px] -mt-3">
          {{ ERROR: "Errors", WARNING: "Warnings", SOURCES: "Active Sources" }[kpiFilter]} 필터 적용 중 —{" "}
          {kpiFilter === "SOURCES"
            ? "Top Sources 카드가 더 넓게 펼쳐져 있습니다."
            : "아래 차트/테이블이 이 조건으로 좁혀져 있습니다."}{" "}
          <button onClick={() => setKpiFilter("ALL")} className="text-dash-mint hover:underline">
            전체 보기
          </button>
        </p>
      )}

      <div>
        <p className="text-dash-faint text-[11px] uppercase tracking-wide mb-3">로그 개요</p>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2">
            <LogVolumeChart rangeKey={rangeKey} />
          </div>
          <RealLevelDistributionChart hours={hours} />
        </div>
      </div>

      <div>
        <p className="text-dash-faint text-[11px] uppercase tracking-wide mb-3">보안 탐지 요약</p>
        <DetectionSourceDonutCompact lookbackMs={preset.lookbackMs} />
      </div>

      <LatencyStatsPanel events={wasEventsForLatency} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <RecentLogsTable
            events={displayEvents}
            filterLevels={REAL_SEVERITY_LEVELS}
            status={logsStatus}
            error={logsError}
          />
        </div>
        <div className="space-y-6">
          <TopSources
            sources={topIps}
            status={topIpsStatus}
            error={topIpsError}
            limit={kpiFilter === "SOURCES" ? 10 : 5}
            highlighted={kpiFilter === "SOURCES"}
          />
          <ErrorRateGauge events={displayEvents} title="Error Rate" subtitle="Major~Critical 비중" />
        </div>
      </div>

      <GeoSummaryCard />
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
