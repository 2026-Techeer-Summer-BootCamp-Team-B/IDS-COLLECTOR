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
import { usePollInterval } from "../context/PollIntervalContext";
import { CHART_COLORS, forTheme, DONUT_PALETTE } from "../data/theme";
import { useTheme } from "../hooks/useTheme";
import { DISPLAY_TIMEZONE } from "../lib/timezone";
import SearchDiscoverView from "./SearchDiscoverView";
import TimeRangePicker from "../components/TimeRangePicker";
import WorldMap from "../components/WorldMap";
// three.js는 이 카드에서만 쓰이는데도 LogDashboard.jsx가 Card/KpiCard 등 공용
// 프리미티브를 export하다보니 다른 뷰(WAS/Falco/K8sAudit/Incidents)들이 전부 이
// 파일을 import한다 — 정적 import로 넣으면 그 뷰들 번들에도 300~400KB가 얹혀버려서
// dynamic import + Suspense로 분리(코드 스플리팅), Overview가 실제로 렌더될 때만
// 별도 청크로 로드되게 한다.
const Globe3D = lazy(() => import("../components/Globe3D"));
import { useGeoStats } from "../hooks/useGeoStats";
import { useK8sTargets } from "../hooks/useK8sTargets";
import GridLayout, { WidthProvider } from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import {
  useOverviewLayout,
  WIDGET_CATALOG,
  catalogEntry,
  chartTypeOptionsFor,
  defaultChartTypeFor,
  makeWidgetUid,
} from "../context/OverviewLayoutContext";

// WidthProvider는 컨테이너 폭을 재서 GridLayout에 넘겨주는 HOC — 컴포넌트 함수
// 안에서 매 렌더마다 호출하면 그때마다 "새 컴포넌트 타입"이 만들어져서 GridLayout이
// 매번 통째로 언마운트/리마운트된다(드래그 도중 이러면 그 자리에서 끊긴다). 그래서
// 모듈 스코프에서 딱 한 번만 감싸둔다.
const ResponsiveGridLayout = WidthProvider(GridLayout);

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
// rows) — active state used to be a neon glow ring, but that read more like
// "look here" than "this is selected". Switched to a darker fill + inset
// border, closer to how a pressed button looks.
export function KpiCard({ label, value, delta, positive = true, onClick, active = false, accent = "mint" }) {
  const Tag = onClick ? "button" : "div";
  const accentBorder = accent === "critical" ? "border-dash-critical/50" : "border-dash-mint/50";
  const displayValue = useCountUp(value);
  return (
    <Tag
      onClick={onClick}
      className={`rounded-2xl p-5 flex-1 min-w-[160px] text-left transition-colors border ${
        onClick ? "cursor-pointer" : ""
      } ${
        active
          ? `bg-dash-bg/60 ${accentBorder}`
          : `bg-dash-surface border-transparent ${onClick ? "hover:bg-dash-surfaceAlt/60" : ""}`
      }`}
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
export function LogVolumeChart({ rangeKey, module, chartType = "area" }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const preset = RANGE_PRESETS.find((p) => p.key === rangeKey);
  const { pollMs } = usePollInterval();
  const { buckets, status, error } = useLogVolume({
    lookbackMs: preset.lookbackMs,
    bucketMs: preset.bucketMs,
    module,
    pollMs,
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
            {chartType === "bar" ? (
              <BarChart data={data}>
                <CartesianGrid stroke={C.surfaceAlt} vertical={false} />
                <XAxis dataKey="label" stroke={C.muted} tickLine={false} axisLine={false} fontSize={11} minTickGap={24} />
                <YAxis stroke={C.muted} tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip contentStyle={{ background: C.surfaceAlt, border: "none", borderRadius: 8, color: C.fg }} />
                <Bar dataKey="total" fill={C.mint} radius={[3, 3, 0, 0]} />
                <Bar dataKey="errorish" fill={C.critical} radius={[3, 3, 0, 0]} />
              </BarChart>
            ) : (
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
            )}
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

// 모듈별(WAS/Falco/K8s Audit) 로그량 추이 적층 그래프 - Log Volume 차트는 셋을
// 합산한 총량만 보여줘서 "지금 어느 소스가 볼륨을 주도하는지"가 안 보이던 문제.
// /stats/volume을 module별로 3번(같은 hours/buckets로) 호출하면 서버가 같은
// date_histogram 경계를 쓰므로 버킷 인덱스가 그대로 정렬돼 안전하게 합칠 수 있다.
export function ModuleVolumeStackedChart() {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const [rangeKey, setRangeKey] = useState("24h");
  const preset = RANGE_PRESETS.find((p) => p.key === rangeKey);
  const { pollMs } = usePollInterval();

  const was = useLogVolume({ lookbackMs: preset.lookbackMs, bucketMs: preset.bucketMs, module: "was", pollMs });
  const falco = useLogVolume({ lookbackMs: preset.lookbackMs, bucketMs: preset.bucketMs, module: "falco", pollMs });
  const k8s = useLogVolume({ lookbackMs: preset.lookbackMs, bucketMs: preset.bucketMs, module: "k8s_audit", pollMs });

  const status = [was.status, falco.status, k8s.status].includes("error")
    ? "error"
    : [was.status, falco.status, k8s.status].every((s) => s === "ready")
      ? "ready"
      : "loading";

  const data = useMemo(() => {
    const len = Math.max(was.buckets.length, falco.buckets.length, k8s.buckets.length);
    const rows = [];
    for (let i = 0; i < len; i++) {
      const ts = was.buckets[i]?.ts ?? falco.buckets[i]?.ts ?? k8s.buckets[i]?.ts;
      if (ts == null) continue;
      rows.push({
        label: formatBucketLabel(new Date(ts), preset.bucketMs),
        was: was.buckets[i]?.total ?? 0,
        falco: falco.buckets[i]?.total ?? 0,
        k8s_audit: k8s.buckets[i]?.total ?? 0,
      });
    }
    return rows;
  }, [was.buckets, falco.buckets, k8s.buckets, preset.bucketMs]);

  const metaWas = getModuleMeta("was");
  const metaFalco = getModuleMeta("falco");
  const metaK8s = getModuleMeta("k8s_audit");

  return (
    <Card
      title="모듈별 로그량 추이"
      subtitle={`Last ${preset.label} · WAS / Falco / K8s Audit 적층`}
      action={<TimeRangePicker value={rangeKey} onChange={setRangeKey} />}
      className="h-80"
    >
      {status === "loading" && <p className="text-dash-muted text-xs">불러오는 중...</p>}
      {status === "error" && <p className="text-dash-critical text-xs">모듈별 로그량을 불러오지 못했습니다.</p>}
      {status === "ready" && (
        <>
          <ResponsiveContainer width="100%" height="82%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="moduleWasFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={metaWas.color} stopOpacity={0.55} />
                  <stop offset="100%" stopColor={metaWas.color} stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="moduleFalcoFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={metaFalco.color} stopOpacity={0.55} />
                  <stop offset="100%" stopColor={metaFalco.color} stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="moduleK8sFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={metaK8s.color} stopOpacity={0.55} />
                  <stop offset="100%" stopColor={metaK8s.color} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={C.surfaceAlt} vertical={false} />
              <XAxis dataKey="label" stroke={C.muted} tickLine={false} axisLine={false} fontSize={11} minTickGap={24} />
              <YAxis stroke={C.muted} tickLine={false} axisLine={false} fontSize={12} />
              <Tooltip contentStyle={tooltipStyle(C)} />
              <Area
                type="monotone"
                dataKey="was"
                name={metaWas.label}
                stackId="module"
                stroke={metaWas.color}
                fill="url(#moduleWasFill)"
                strokeWidth={1.5}
              />
              <Area
                type="monotone"
                dataKey="falco"
                name={metaFalco.label}
                stackId="module"
                stroke={metaFalco.color}
                fill="url(#moduleFalcoFill)"
                strokeWidth={1.5}
              />
              <Area
                type="monotone"
                dataKey="k8s_audit"
                name={metaK8s.label}
                stackId="module"
                stroke={metaK8s.color}
                fill="url(#moduleK8sFill)"
                strokeWidth={1.5}
              />
            </AreaChart>
          </ResponsiveContainer>
          <div className="flex gap-4 text-xs text-dash-muted mt-2">
            {[metaWas, metaFalco, metaK8s].map((m) => (
              <span key={m.label} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: m.color }} /> {m.label}
              </span>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

// Log Levels 차트 실데이터 버전 — event.severity 1~4 그대로 4개 막대(기존
// LevelDistributionChart의 9단계는 FalcoView 등 여전히 mock인 다른 뷰가
// 재사용 중이라 그대로 두고, Overview 전용으로 새로 뺐다).
export function RealLevelDistributionChart({ hours, module, chartType = "bar" }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const { pollMs } = usePollInterval();
  const { levels, total, status, error } = useLogLevels({ hours, module, pollMs });

  const data = REAL_SEVERITY_LEVELS.map((l, i) => {
    const found = levels.find((x) => x.severity === l.severity);
    return { key: l.key, label: l.label, count: found ? found.count : 0, color: DONUT_PALETTE[i % DONUT_PALETTE.length] };
  });
  const [activeIndex, setPaused] = useAutoCycleIndex(chartType === "donut" ? data.length : 0);

  return (
    <Card title="Log Levels" subtitle={status === "ready" ? `선택 구간 · ${total}건` : "불러오는 중..."} className="h-80">
      {status === "error" && <p className="text-dash-critical text-xs">{error}</p>}
      {status !== "error" && chartType === "donut" && (
        <div className="flex items-center gap-4 h-[88%]">
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
      {status !== "error" && chartType !== "donut" && <CategoryBarChart data={data} C={C} height={220} />}
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

// 카테고리형 데이터({key,label,count,color}[])의 막대그래프 버전 - 탐지소스/
// 심각도/K8s네임스페이스 도넛 3개 + Log Levels 위젯이 사용자 모드에서 "막대"로
// 전환됐을 때 공통으로 쓴다(도넛+범례 쪽은 각 위젯이 기존 JSX를 그대로 씀 -
// 호버 자동순환(useAutoCycleIndex) 상태를 위젯마다 이미 들고 있어서 그쪽까지
// 억지로 공용화하면 오히려 코드가 더 꼬인다).
function CategoryBarChart({ data, C, height = 160 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ bottom: 8 }}>
        <CartesianGrid stroke={C.surfaceAlt} vertical={false} />
        <XAxis dataKey="label" stroke={C.muted} tickLine={false} axisLine={false} fontSize={10} interval={0} />
        <YAxis stroke={C.muted} tickLine={false} axisLine={false} fontSize={11} />
        <Tooltip contentStyle={tooltipStyle(C)} />
        <Bar dataKey="count" radius={[6, 6, 0, 0]} isAnimationActive animationDuration={700} animationEasing="ease-out">
          {data.map((d) => (
            <Cell key={d.key} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
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
function DetectionSourceDonutCompact({ lookbackMs, chartType = "donut" }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const { byModule, status, error } = useDetectionSources({ lookbackMs });
  const data = useMemo(
    () =>
      byModule
        .filter((d) => d.count > 0)
        .map((d, i) => {
          const meta = getModuleMeta(d.module);
          return { key: d.module, count: d.count, label: meta.label, color: DONUT_PALETTE[i % DONUT_PALETTE.length] };
        }),
    [byModule, theme]
  );
  const total = data.reduce((s, d) => s + d.count, 0);
  const [activeIndex, setPaused] = useAutoCycleIndex(chartType === "donut" ? data.length : 0);

  return (
    <Card title="탐지 소스별 분포" subtitle={status === "ready" ? `WAS / Falco / K8s Audit · 총 ${total}건` : "불러오는 중..."}>
      {status === "error" && <p className="text-dash-critical text-xs">{error}</p>}
      {status === "ready" && data.length === 0 && <p className="text-dash-muted text-xs">이 구간에는 로그가 없습니다.</p>}
      {data.length > 0 && chartType === "bar" && <CategoryBarChart data={data} C={C} height={150} />}
      {data.length > 0 && chartType === "donut" && (
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

// 심각도 분포 도넛 — 위 Log Levels 막대그래프(RealLevelDistributionChart)와
// 같은 데이터(GET /stats/levels)를 비율로 한눈에 보여주는 버전. 탐지 소스별
// 분포 도넛과 나란히 둬서 "어느 계층에서" + "얼마나 심각한 로그가 많은지"를
// 같은 화면에서 비교할 수 있게 한다.
function SeverityDonutCompact({ hours, chartType = "donut" }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const { pollMs } = usePollInterval();
  const { levels, total, status, error } = useLogLevels({ hours, pollMs });
  const data = useMemo(
    () =>
      REAL_SEVERITY_LEVELS.map((l) => ({
        key: l.key,
        count: levels.find((x) => x.severity === l.severity)?.count ?? 0,
        label: l.label,
      }))
        .filter((d) => d.count > 0)
        .map((d, i) => ({ ...d, color: DONUT_PALETTE[i % DONUT_PALETTE.length] })),
    [levels]
  );
  const [activeIndex, setPaused] = useAutoCycleIndex(chartType === "donut" ? data.length : 0);

  return (
    <Card title="심각도 분포" subtitle={status === "ready" ? `선택 구간 · 총 ${total}건` : "불러오는 중..."}>
      {status === "error" && <p className="text-dash-critical text-xs">{error}</p>}
      {status === "ready" && data.length === 0 && <p className="text-dash-muted text-xs">이 구간에는 로그가 없습니다.</p>}
      {data.length > 0 && chartType === "bar" && <CategoryBarChart data={data} C={C} height={150} />}
      {data.length > 0 && chartType === "donut" && (
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

// K8s 네임스페이스별 분포 도넛 — GET /stats/k8s-targets(namespace/리소스별 집계)를
// 네임스페이스 단위로 합쳐서 보여준다. 지금은 관찰 대상(Juice Shop)이 하나뿐이라
// 조각이 하나일 수 있지만, 나중에 인스턴스가 늘어나면(네임스페이스 여러 개)
// 여기서 바로 비교가 된다 — Infrastructure 탭의 K8s 타깃 랭킹과 같은 소스.
function K8sNamespaceDonutCompact({ chartType = "donut" }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const { targets, status, error } = useK8sTargets({ limit: 20 });
  const data = useMemo(() => {
    const byNamespace = {};
    targets.forEach((t) => {
      byNamespace[t.namespace] = (byNamespace[t.namespace] || 0) + t.count;
    });
    return Object.entries(byNamespace)
      .sort((a, b) => b[1] - a[1])
      .map(([namespace, count], i) => ({ key: namespace, label: namespace, count, color: DONUT_PALETTE[i % DONUT_PALETTE.length] }));
  }, [targets]);
  const total = data.reduce((s, d) => s + d.count, 0);
  const [activeIndex, setPaused] = useAutoCycleIndex(chartType === "donut" ? data.length : 0);

  return (
    <Card title="K8s 네임스페이스별 분포" subtitle={status === "ready" ? `전체 기간 · 총 ${total}건` : "불러오는 중..."}>
      {status === "error" && <p className="text-dash-critical text-xs">{error}</p>}
      {status === "ready" && data.length === 0 && <p className="text-dash-muted text-xs">데이터가 없습니다.</p>}
      {data.length > 0 && chartType === "bar" && <CategoryBarChart data={data} C={C} height={150} />}
      {data.length > 0 && chartType === "donut" && (
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
                      {log.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: DISPLAY_TIMEZONE })}
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
                            <p className="text-dash-fg">{log.timestamp.toLocaleString("ko-KR", { timeZone: DISPLAY_TIMEZONE })}</p>
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

// 커스텀 대시보드/빌더에서만 위젯을 감싸는 얇은 프레임 - 위쪽 좁은 바가 드래그
// 핸들(react-grid-layout의 draggableHandle=".widget-drag-handle"과 매칭), 본문은
// 기존 위젯을 그대로 넣고 넘치면 스크롤. 기본 모드는 이 프레임을 아예 거치지
// 않으므로(아래 return의 분기 참고) 지금까지의 화면엔 전혀 영향이 없다.
//
// 인스턴스 기반 위젯 프레임 - context를 직접 참조하지 않고 props로만 동작한다.
// 같은 widgetType(예: "log-volume")을 여러 개 캔버스에 놓을 수 있어서(중복 허용),
// chartType/onChartTypeChange는 위젯 "인스턴스" 단위로 호출부에서 내려준다.
// onRemove가 있을 때만(빌더에서) 제거 버튼이 뜬다 - 저장된 대시보드를 그냥 보는
// 중(CustomDashboardView)에는 실수로 위젯이 지워지지 않도록 onRemove를 안 넘긴다.
function WidgetFrame({ widgetType, title, chartType, onChartTypeChange, onRemove, children }) {
  const options = chartTypeOptionsFor(widgetType);

  return (
    <div className="h-full flex flex-col bg-dash-surface rounded-2xl overflow-hidden border border-dash-mint/15">
      <div className="widget-drag-handle cursor-move flex items-center gap-2 px-3 py-1.5 bg-dash-surfaceAlt/70 text-dash-muted text-[10px] uppercase tracking-wide shrink-0 select-none">
        <span className="opacity-60 tracking-tighter">⠿⠿</span>
        <span className="truncate flex-1">{title}</span>
        {options && onChartTypeChange && (
          <div
            className="flex items-center gap-0.5 shrink-0 normal-case tracking-normal cursor-default"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onChartTypeChange(opt.value)}
                title={`${opt.label}로 표시`}
                className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                  chartType === opt.value
                    ? "bg-dash-mint/25 text-dash-mint"
                    : "text-dash-muted hover:text-dash-fg hover:bg-dash-surface"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
        {onRemove && (
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onRemove}
            title="캔버스에서 위젯 제거"
            className="shrink-0 normal-case text-dash-muted hover:text-dash-critical text-xs leading-none px-1 cursor-default"
          >
            ✕
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-2">{children}</div>
    </div>
  );
}

// 캔버스(react-grid-layout)의 위젯 배치 상태(uid 기준)를 실제 widgets 배열에
// 병합한다 - onLayoutChange/onDrop 핸들러 여러 곳에서 재사용.
function applyLayoutToWidgets(widgets, newLayout) {
  let changed = false;
  const next = widgets.map((w) => {
    const pos = newLayout.find((l) => l.i === w.uid);
    if (!pos) return w;
    if (pos.x !== w.x || pos.y !== w.y || pos.w !== w.w || pos.h !== w.h) {
      changed = true;
      return { ...w, x: pos.x, y: pos.y, w: pos.w, h: pos.h };
    }
    return w;
  });
  return changed ? next : widgets;
}

// 왼쪽 위젯 팔레트 + 빈(또는 기존) 캔버스에 드래그로 위젯을 추가/재배치하고,
// 이름을 정해 저장하는 빌더. baseDashboard가 있으면 그 위젯들로 시작(수정),
// 없으면 빈 캔버스에서 시작(신규 생성).
function DashboardBuilder({ baseDashboard, onCancel, onSave, renderWidgetContent }) {
  const [widgets, setWidgets] = useState(() => (baseDashboard ? baseDashboard.widgets.map((w) => ({ ...w })) : []));
  const [name, setName] = useState(baseDashboard ? baseDashboard.name : "");
  const [draggingType, setDraggingType] = useState(null);

  const handleDrop = (_newLayout, item, e) => {
    const type = e.dataTransfer.getData("text/plain");
    const entry = catalogEntry(type);
    if (!entry) return;
    setWidgets((prev) => [
      ...prev,
      {
        uid: makeWidgetUid(),
        type,
        x: item.x,
        y: item.y,
        w: entry.w,
        h: entry.h,
        chartType: defaultChartTypeFor(type),
      },
    ]);
  };

  const handleLayoutChange = (newLayout) => {
    setWidgets((prev) => applyLayoutToWidgets(prev, newLayout));
  };

  const removeWidget = (uid) => setWidgets((prev) => prev.filter((w) => w.uid !== uid));
  const setWidgetChartType = (uid, type) =>
    setWidgets((prev) => prev.map((w) => (w.uid === uid ? { ...w, chartType: type } : w)));

  const gridLayout = widgets.map((w) => ({ i: w.uid, x: w.x, y: w.y, w: w.w, h: w.h }));
  const dropEntry = draggingType ? catalogEntry(draggingType) : null;
  const canSave = widgets.length > 0 && name.trim().length > 0;

  return (
    <div className="flex flex-col lg:flex-row gap-4 items-start">
      <div className="w-full lg:w-56 shrink-0 bg-dash-surface rounded-2xl border border-dash-mint/15 p-3 space-y-1.5">
        <p className="text-dash-faint text-[11px] uppercase tracking-wide mb-1">위젯 목록 (드래그해서 캔버스에 추가)</p>
        {WIDGET_CATALOG.map((w) => (
          <div
            key={w.type}
            draggable
            unselectable="on"
            onDragStart={(e) => {
              setDraggingType(w.type);
              e.dataTransfer.setData("text/plain", w.type);
              e.dataTransfer.effectAllowed = "copy";
            }}
            onDragEnd={() => setDraggingType(null)}
            className="cursor-grab active:cursor-grabbing text-xs px-3 py-2 rounded-lg bg-dash-surfaceAlt/70 text-dash-fg hover:bg-dash-mint/15 hover:text-dash-mint transition-colors select-none"
          >
            {w.label}
          </div>
        ))}
      </div>

      <div className="flex-1 min-w-0 w-full space-y-3">
        <div className="flex items-center gap-2 bg-dash-surface rounded-2xl border border-dash-mint/15 px-3 py-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="대시보드 이름"
            className="flex-1 min-w-0 bg-transparent text-sm text-dash-fg placeholder:text-dash-faint outline-none"
          />
          <button
            onClick={onCancel}
            className="text-xs font-medium px-3 py-1.5 rounded-lg text-dash-muted hover:text-dash-fg hover:bg-dash-surfaceAlt transition-colors whitespace-nowrap"
          >
            취소
          </button>
          <button
            onClick={() => canSave && onSave(name.trim(), widgets)}
            disabled={!canSave}
            title={!canSave ? "이름을 입력하고 위젯을 1개 이상 추가하세요" : undefined}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
              canSave
                ? "bg-dash-mint/15 text-dash-mint hover:bg-dash-mint/25"
                : "bg-dash-surfaceAlt text-dash-faint cursor-not-allowed"
            }`}
          >
            저장하기
          </button>
        </div>

        <div className="relative">
          {widgets.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-dash-faint text-xs pointer-events-none border border-dashed border-dash-mint/25 rounded-2xl px-6 text-center">
              왼쪽 목록에서 위젯을 이 캔버스로 드래그해서 추가하세요.
            </div>
          )}
          <ResponsiveGridLayout
            className="layout"
            layout={gridLayout}
            onLayoutChange={handleLayoutChange}
            cols={12}
            rowHeight={20}
            margin={[16, 16]}
            draggableHandle=".widget-drag-handle"
            compactType="vertical"
            isDroppable
            onDrop={handleDrop}
            droppingItem={{ i: "__dropping__", w: dropEntry?.w ?? 4, h: dropEntry?.h ?? 6 }}
            style={{ minHeight: widgets.length === 0 ? 220 : undefined }}
          >
            {widgets.map((w) => (
              <div key={w.uid}>
                <WidgetFrame
                  widgetType={w.type}
                  title={catalogEntry(w.type)?.label}
                  chartType={w.chartType}
                  onChartTypeChange={(type) => setWidgetChartType(w.uid, type)}
                  onRemove={() => removeWidget(w.uid)}
                >
                  {renderWidgetContent(w.type, w.chartType)}
                </WidgetFrame>
              </div>
            ))}
          </ResponsiveGridLayout>
        </div>
      </div>
    </div>
  );
}

// 저장된 커스텀 대시보드 보기 - 드래그/리사이즈/차트타입 전환은 바로바로 저장되고
// ("위젯 편집" 없이도 배치만 다듬는 건 즉시 반영), 위젯을 추가/제거하려면
// "위젯 편집" 버튼으로 DashboardBuilder를 연다.
function CustomDashboardView({ dashboard, renderWidgetContent, onLayoutCommit, onChartTypeCommit, onEdit }) {
  const gridLayout = dashboard.widgets.map((w) => ({ i: w.uid, x: w.x, y: w.y, w: w.w, h: w.h }));

  const handleLayoutChange = (newLayout) => {
    const next = applyLayoutToWidgets(dashboard.widgets, newLayout);
    if (next !== dashboard.widgets) onLayoutCommit(next);
  };

  const handleChartType = (uid, type) => {
    onChartTypeCommit(dashboard.widgets.map((w) => (w.uid === uid ? { ...w, chartType: type } : w)));
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          onClick={onEdit}
          className="text-xs font-medium px-3 py-1.5 rounded-lg text-dash-muted hover:text-dash-fg hover:bg-dash-surfaceAlt transition-colors"
        >
          위젯 편집
        </button>
      </div>
      {dashboard.widgets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-dash-mint/20 py-16 text-center text-dash-faint text-xs">
          이 대시보드엔 위젯이 없습니다. "위젯 편집"에서 추가하세요.
        </div>
      ) : (
        <ResponsiveGridLayout
          className="layout"
          layout={gridLayout}
          onLayoutChange={handleLayoutChange}
          cols={12}
          rowHeight={20}
          margin={[16, 16]}
          draggableHandle=".widget-drag-handle"
          compactType="vertical"
        >
          {dashboard.widgets.map((w) => (
            <div key={w.uid}>
              <WidgetFrame
                widgetType={w.type}
                title={catalogEntry(w.type)?.label}
                chartType={w.chartType}
                onChartTypeChange={(type) => handleChartType(w.uid, type)}
              >
                {renderWidgetContent(w.type, w.chartType)}
              </WidgetFrame>
            </div>
          ))}
        </ResponsiveGridLayout>
      )}
    </div>
  );
}

// "위젯 설정" 드롭다운 - 기본 모드 / 저장된 커스텀 대시보드 목록(각각 선택·편집·삭제) /
// 추가하기. 기본 모드 항목은 항상 맨 위에 고정, activeId==="default"일 때 선택됨.
function WidgetSettingsMenu({ dashboards, activeId, setActiveId, deleteDashboard, onCreateNew, onEditActive }) {
  const [open, setOpen] = useState(false);
  const activeDashboard = dashboards.find((d) => d.id === activeId);
  const label = activeId === "default" ? "기본 모드" : activeDashboard?.name || "커스텀 대시보드";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
          open ? "bg-dash-mint/15 text-dash-mint" : "bg-dash-surface text-dash-muted hover:text-dash-fg hover:bg-dash-surfaceAlt"
        }`}
      >
        위젯 설정 · {label}
        <span>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <>
          {/* 메뉴 바깥 클릭하면 닫히도록 - 화면 전체를 덮는 투명 레이어 */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-64 bg-dash-surface border border-dash-mint/15 rounded-xl shadow-lg py-1">
            <button
              onClick={() => {
                setActiveId("default");
                setOpen(false);
              }}
              className={`w-full text-left text-xs px-3 py-2 hover:bg-dash-surfaceAlt/70 transition-colors ${
                activeId === "default" ? "text-dash-mint" : "text-dash-fg"
              }`}
            >
              기본 모드
            </button>
            {dashboards.length > 0 && <div className="my-1 border-t border-dash-mint/10" />}
            {dashboards.map((d) => (
              <div key={d.id} className={`flex items-center gap-0.5 pl-1 pr-1.5 ${activeId === d.id ? "bg-dash-mint/10" : ""}`}>
                <button
                  onClick={() => {
                    setActiveId(d.id);
                    setOpen(false);
                  }}
                  className={`flex-1 min-w-0 text-left text-xs px-2 py-2 truncate transition-colors ${
                    activeId === d.id ? "text-dash-mint" : "text-dash-fg"
                  }`}
                >
                  {d.name}
                </button>
                <button
                  onClick={() => {
                    onEditActive(d.id);
                    setOpen(false);
                  }}
                  title="위젯 편집"
                  className="shrink-0 text-[10px] px-1.5 py-1 rounded text-dash-muted hover:text-dash-fg hover:bg-dash-surfaceAlt transition-colors"
                >
                  편집
                </button>
                <button
                  onClick={() => {
                    if (window.confirm(`"${d.name}" 대시보드를 삭제할까요?`)) deleteDashboard(d.id);
                  }}
                  title="삭제"
                  className="shrink-0 text-[10px] px-1.5 py-1 rounded text-dash-muted hover:text-dash-critical hover:bg-dash-critical/10 transition-colors"
                >
                  삭제
                </button>
              </div>
            ))}
            <div className="my-1 border-t border-dash-mint/10" />
            <button
              onClick={() => {
                onCreateNew();
                setOpen(false);
              }}
              className="w-full text-left text-xs px-3 py-2 text-dash-mint hover:bg-dash-mint/10 transition-colors"
            >
              + 추가하기
            </button>
          </div>
        </>
      )}
    </div>
  );
}

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
  const { pollMs } = usePollInterval();

  // GET /stats/kpi — 상단 4개 KPI 카드(Total/Errors/Warnings/Active Sources +
  // 이전 구간 대비 델타). pollMs로 갱신(기본 2초, Admin 페이지에서 커스텀 가능) —
  // 더미 로그 생성기 돌릴 때 화면이 수동 새로고침 없이 따라 올라가야 한다는 피드백 반영.
  const { data: kpi, status: kpiStatus } = useKpi({ hours, pollMs });

  // GET /logs — 아래 차트/테이블에 실제로 흘려보내는 이벤트. kpiFilter에 따라
  // min_severity로 서버에서 미리 좁혀서 요청.
  const { logs: rawLogs, status: logsStatus, error: logsError } = useLogs({
    lookbackMs: preset.lookbackMs,
    minSeverity: KPI_MIN_SEVERITY[kpiFilter],
    limit: 300,
    pollMs,
  });
  const displayEvents = useMemo(
    () => (kpiFilter === "WARNING" ? rawLogs.filter((e) => e.severity === REAL_WARNING_SEVERITY) : rawLogs),
    [rawLogs, kpiFilter]
  );

  // API Latency 패널 전용 - 위 rawLogs(전체 모듈 뒤섞인 최근 300건)에서
  // module==="was"만 골라내는 방식은 k8s_audit이 볼륨을 압도하는 클러스터에서는
  // 300건 안에 WAS 이벤트가 하나도 안 걸려 패널이 "데이터 없음"으로 보이는
  // 문제가 있었다(2026-07-14, 실측 확인 - WASView.jsx는 처음부터 module: "was"로
  // 서버에 직접 필터링해서 이 문제가 없었음). 여기도 같은 패턴으로 맞춘다.
  const { logs: wasEventsForLatency } = useLogs({
    lookbackMs: preset.lookbackMs,
    module: "was",
    limit: 300,
    pollMs,
  });

  // GET /stats/top-ips — 실제 백엔드 집계. kpiFilter가 SOURCES면 더 많이(limit
  // 10) 보여주므로 그만큼 넉넉히 요청.
  const { items: topIps, status: topIpsStatus, error: topIpsError } = useTopIps({
    lookbackMs: preset.lookbackMs,
    limit: kpiFilter === "SOURCES" ? 10 : 5,
    pollMs,
  });

  const { dashboards, activeId, setActiveId, createDashboard, updateDashboard, deleteDashboard, getDashboard } =
    useOverviewLayout();
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingDashboardId, setEditingDashboardId] = useState(null);

  function openNewBuilder() {
    setEditingDashboardId(null);
    setBuilderOpen(true);
  }
  function openEditBuilder(id) {
    setEditingDashboardId(id);
    setBuilderOpen(true);
  }
  function handleBuilderCancel() {
    setBuilderOpen(false);
    setEditingDashboardId(null);
  }
  function handleBuilderSave(name, widgets) {
    if (editingDashboardId) {
      updateDashboard(editingDashboardId, { name, widgets });
      setActiveId(editingDashboardId);
    } else {
      createDashboard(name, widgets);
    }
    setBuilderOpen(false);
    setEditingDashboardId(null);
  }

  // 커스텀 대시보드(위젯 설정에서 만든 것들)와 빌더 전용 렌더러 - 위젯 타입 +
  // 인스턴스별 chartType을 받아 JSX를 만든다. 기본 모드는 이 함수를 전혀 쓰지
  // 않고 아래의 고정 변수들(kpiTotalWidget 등, chartType 없음)만 참조한다 —
  // 그래야 커스텀 대시보드에서 뭘 바꾸든 기본 모드가 절대 영향받지 않는다.
  function renderWidgetContent(type, chartType) {
    switch (type) {
      case "kpi-total":
        return (
          <KpiCard
            label={`Total Logs (${preset.label})`}
            value={kpiStatus === "ready" ? kpi.current.total : "-"}
            delta={kpiStatus === "ready" && kpi.delta_pct.total != null ? `${Math.abs(kpi.delta_pct.total)}%` : undefined}
            positive={kpiStatus === "ready" ? (kpi.delta_pct.total ?? 0) >= 0 : true}
            onClick={() => setKpiFilter("ALL")}
            active={kpiFilter === "ALL"}
          />
        );
      case "kpi-errors":
        return (
          <KpiCard
            label="Errors (Major~Critical)"
            value={kpiStatus === "ready" ? kpi.current.errors : "-"}
            delta={kpiStatus === "ready" && kpi.delta_pct.errors != null ? `${Math.abs(kpi.delta_pct.errors)}%` : undefined}
            positive={kpiStatus === "ready" ? (kpi.delta_pct.errors ?? 0) <= 0 : false}
            onClick={() => setKpiFilter("ERROR")}
            active={kpiFilter === "ERROR"}
            accent="critical"
          />
        );
      case "kpi-warnings":
        return (
          <KpiCard
            label="Warnings (Minor)"
            value={kpiStatus === "ready" ? kpi.current.warnings : "-"}
            delta={kpiStatus === "ready" && kpi.delta_pct.warnings != null ? `${Math.abs(kpi.delta_pct.warnings)}%` : undefined}
            positive={kpiStatus === "ready" ? (kpi.delta_pct.warnings ?? 0) <= 0 : true}
            onClick={() => setKpiFilter("WARNING")}
            active={kpiFilter === "WARNING"}
          />
        );
      case "kpi-sources":
        return (
          <KpiCard
            label="Active Sources"
            value={kpiStatus === "ready" ? kpi.current.sources : "-"}
            delta={
              kpiStatus === "ready" && kpi.sources_delta !== 0
                ? `${kpi.sources_delta > 0 ? "+" : ""}${kpi.sources_delta} new`
                : undefined
            }
            positive={kpiStatus === "ready" ? kpi.sources_delta >= 0 : true}
            onClick={() => setKpiFilter("SOURCES")}
            active={kpiFilter === "SOURCES"}
          />
        );
      case "log-volume":
        return <LogVolumeChart rangeKey={rangeKey} chartType={chartType || "area"} />;
      case "level-distribution":
        return <RealLevelDistributionChart hours={hours} chartType={chartType || "bar"} />;
      case "donut-source":
        return <DetectionSourceDonutCompact lookbackMs={preset.lookbackMs} chartType={chartType || "donut"} />;
      case "donut-severity":
        return <SeverityDonutCompact hours={hours} chartType={chartType || "donut"} />;
      case "donut-k8s-namespace":
        return <K8sNamespaceDonutCompact chartType={chartType || "donut"} />;
      case "latency-stats":
        return <LatencyStatsPanel events={wasEventsForLatency} />;
      case "module-volume":
        return <ModuleVolumeStackedChart />;
      case "recent-logs":
        return (
          <RecentLogsTable events={displayEvents} filterLevels={REAL_SEVERITY_LEVELS} status={logsStatus} error={logsError} />
        );
      case "top-sources":
        return (
          <TopSources
            sources={topIps}
            status={topIpsStatus}
            error={topIpsError}
            limit={kpiFilter === "SOURCES" ? 10 : 5}
            highlighted={kpiFilter === "SOURCES"}
          />
        );
      case "error-rate":
        return <ErrorRateGauge events={displayEvents} title="Error Rate" subtitle="Major~Critical 비중" />;
      case "geo-summary":
        return <GeoSummaryCard />;
      default:
        return null;
    }
  }

  // 기본 모드 전용 고정 위젯들 - chartType 없이 각 컴포넌트 자체 기본값만 쓴다.
  // 커스텀 대시보드의 chartType 변경과는 완전히 분리된 별도 변수들.
  const kpiTotalWidget = (
    <KpiCard
      label={`Total Logs (${preset.label})`}
      value={kpiStatus === "ready" ? kpi.current.total : "-"}
      delta={kpiStatus === "ready" && kpi.delta_pct.total != null ? `${Math.abs(kpi.delta_pct.total)}%` : undefined}
      positive={kpiStatus === "ready" ? (kpi.delta_pct.total ?? 0) >= 0 : true}
      onClick={() => setKpiFilter("ALL")}
      active={kpiFilter === "ALL"}
    />
  );
  const kpiErrorsWidget = (
    <KpiCard
      label="Errors (Major~Critical)"
      value={kpiStatus === "ready" ? kpi.current.errors : "-"}
      delta={kpiStatus === "ready" && kpi.delta_pct.errors != null ? `${Math.abs(kpi.delta_pct.errors)}%` : undefined}
      positive={kpiStatus === "ready" ? (kpi.delta_pct.errors ?? 0) <= 0 : false}
      onClick={() => setKpiFilter("ERROR")}
      active={kpiFilter === "ERROR"}
      accent="critical"
    />
  );
  const kpiWarningsWidget = (
    <KpiCard
      label="Warnings (Minor)"
      value={kpiStatus === "ready" ? kpi.current.warnings : "-"}
      delta={kpiStatus === "ready" && kpi.delta_pct.warnings != null ? `${Math.abs(kpi.delta_pct.warnings)}%` : undefined}
      positive={kpiStatus === "ready" ? (kpi.delta_pct.warnings ?? 0) <= 0 : true}
      onClick={() => setKpiFilter("WARNING")}
      active={kpiFilter === "WARNING"}
    />
  );
  const kpiSourcesWidget = (
    <KpiCard
      label="Active Sources"
      value={kpiStatus === "ready" ? kpi.current.sources : "-"}
      delta={kpiStatus === "ready" && kpi.sources_delta !== 0 ? `${kpi.sources_delta > 0 ? "+" : ""}${kpi.sources_delta} new` : undefined}
      positive={kpiStatus === "ready" ? kpi.sources_delta >= 0 : true}
      onClick={() => setKpiFilter("SOURCES")}
      active={kpiFilter === "SOURCES"}
    />
  );
  const logVolumeWidget = <LogVolumeChart rangeKey={rangeKey} />;
  const levelDistributionWidget = <RealLevelDistributionChart hours={hours} />;
  const donutSourceWidget = <DetectionSourceDonutCompact lookbackMs={preset.lookbackMs} />;
  const donutSeverityWidget = <SeverityDonutCompact hours={hours} />;
  const donutK8sWidget = <K8sNamespaceDonutCompact />;
  const latencyWidget = <LatencyStatsPanel events={wasEventsForLatency} />;
  const recentLogsWidget = (
    <RecentLogsTable events={displayEvents} filterLevels={REAL_SEVERITY_LEVELS} status={logsStatus} error={logsError} />
  );
  const topSourcesWidget = (
    <TopSources
      sources={topIps}
      status={topIpsStatus}
      error={topIpsError}
      limit={kpiFilter === "SOURCES" ? 10 : 5}
      highlighted={kpiFilter === "SOURCES"}
    />
  );
  const errorRateWidget = <ErrorRateGauge events={displayEvents} title="Error Rate" subtitle="Major~Critical 비중" />;
  const geoWidget = <GeoSummaryCard />;

  const activeDashboard = activeId !== "default" ? getDashboard(activeId) : null;

  return (
    <div className="space-y-6">
      <SearchDiscoverView
        rangeKey={rangeKey}
        onRangeChange={setRangeKey}
        expanded={searchExpanded}
        setExpanded={setSearchExpanded}
        onResultsCountChange={setSearchHits}
      />

      {/* 예전엔 전체 폭 바였는데, 관리자 페이지 탭 스위처처럼 우측 상단에
          작은 버튼 형태로 - 화면을 덜 차지하면서 상태(펼침/접힘)도 pill
          active 색으로 바로 구분되게 바꿨다. 위젯 설정 메뉴도 같은 행에 둔다. */}
      <div className="flex items-center justify-between gap-3">
        <WidgetSettingsMenu
          dashboards={dashboards}
          activeId={activeId}
          setActiveId={setActiveId}
          deleteDashboard={deleteDashboard}
          onCreateNew={openNewBuilder}
          onEditActive={openEditBuilder}
        />
        <button
          onClick={() => setSearchExpanded((e) => !e)}
          className={`inline-flex items-center gap-2 text-xs font-medium px-3.5 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
            searchExpanded
              ? "bg-dash-mint/15 text-dash-mint"
              : "bg-dash-surface text-dash-muted hover:text-dash-fg hover:bg-dash-surfaceAlt"
          }`}
        >
          <span className="font-semibold">{searchHits.toLocaleString()} hits</span>
          검색 결과 {searchExpanded ? "접기" : "펼치기"}
          <span>{searchExpanded ? "▴" : "▾"}</span>
        </button>
      </div>

      {kpiFilter !== "ALL" && (
        <p className="text-dash-faint text-[11px]">
          {{ ERROR: "Errors", WARNING: "Warnings", SOURCES: "Active Sources" }[kpiFilter]} 필터 적용 중 —{" "}
          {kpiFilter === "SOURCES"
            ? "Top Sources 카드가 더 넓게 펼쳐져 있습니다."
            : "아래 차트/테이블이 이 조건으로 좁혀져 있습니다."}{" "}
          <button onClick={() => setKpiFilter("ALL")} className="text-dash-mint hover:underline">
            전체 보기
          </button>
        </p>
      )}

      {builderOpen ? (
        <DashboardBuilder
          baseDashboard={editingDashboardId ? getDashboard(editingDashboardId) : null}
          onCancel={handleBuilderCancel}
          onSave={handleBuilderSave}
          renderWidgetContent={renderWidgetContent}
        />
      ) : activeDashboard ? (
        <CustomDashboardView
          dashboard={activeDashboard}
          renderWidgetContent={renderWidgetContent}
          onLayoutCommit={(widgets) => updateDashboard(activeDashboard.id, { widgets })}
          onChartTypeCommit={(widgets) => updateDashboard(activeDashboard.id, { widgets })}
          onEdit={() => openEditBuilder(activeDashboard.id)}
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-4">
            {kpiTotalWidget}
            {kpiErrorsWidget}
            {kpiWarningsWidget}
            {kpiSourcesWidget}
          </div>

          <div>
            <p className="text-dash-faint text-[11px] uppercase tracking-wide mb-3">로그 개요</p>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              <div className="xl:col-span-2">{logVolumeWidget}</div>
              {levelDistributionWidget}
            </div>
          </div>

          <div>
            <p className="text-dash-faint text-[11px] uppercase tracking-wide mb-3">보안 탐지 요약</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {donutSourceWidget}
              {donutSeverityWidget}
              {donutK8sWidget}
            </div>
          </div>

          {latencyWidget}

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2">{recentLogsWidget}</div>
            <div className="space-y-6">
              {topSourcesWidget}
              {errorRateWidget}
            </div>
          </div>

          {geoWidget}
        </>
      )}
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
