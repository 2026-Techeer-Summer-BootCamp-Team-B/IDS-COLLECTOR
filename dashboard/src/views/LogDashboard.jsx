import React, { useMemo, useState, useEffect, useRef, Suspense, lazy } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  ComposedChart,
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
import { REAL_SEVERITY_LEVELS, REAL_ERROR_MIN_SEVERITY, REAL_WARNING_SEVERITY, getRealSeverityMeta } from "../data/realSeverity";
import { getModuleMeta } from "../data/moduleMeta";
import { useLiveAttackFeed } from "../hooks/useLiveFeed";
import { ALL_LEVELS, ERROR_BAND, WARN_BAND, getLevelMeta, getDisplayTier } from "../data/logLevels";
import { RANGE_PRESETS, formatBucketLabel, detectSpike } from "../data/timeSeries";
import { usePollInterval } from "../context/PollIntervalContext";
import { CHART_COLORS, forTheme, DONUT_PALETTE } from "../data/theme";
import { useTheme } from "../hooks/useTheme";
import { DISPLAY_TIMEZONE } from "../lib/timezone";
import SearchDiscoverView from "./SearchDiscoverView";
import TimeRangePicker from "../components/TimeRangePicker";
import GoogleGeoMap from "../components/GoogleGeoMap";
// three.js는 이 카드에서만 쓰이는데도 LogDashboard.jsx가 Card/KpiCard 등 공용
// 프리미티브를 export하다보니 다른 뷰(WAS/Falco/K8sAudit/Incidents)들이 전부 이
// 파일을 import한다 — 정적 import로 넣으면 그 뷰들 번들에도 300~400KB가 얹혀버려서
// dynamic import + Suspense로 분리(코드 스플리팅), Overview가 실제로 렌더될 때만
// 별도 청크로 로드되게 한다.
const Globe3D = lazy(() => import("../components/Globe3D"));
import { useGeoStats } from "../hooks/useGeoStats";
import { useScenarios } from "../hooks/useScenarios";
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
      className={`rounded-2xl p-5 flex-1 w-full h-full min-w-[160px] text-left transition-colors border ${
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
// 2026-07-15: 위젯별 차트 타입 전환은 원래 "위젯 설정"으로 만든 커스텀
// 대시보드에서만 됐는데, 기본 모드에서도 쓰고 싶다는 피드백 - 카드 우측
// 상단에 작은 토글을 추가한다. 커스텀 대시보드(WidgetFrame)는 이미 자기
// 방식대로 chartType을 props로 내려주고 있으니, 그 경우엔 여기서 또 토글을
// 그리지 않도록 "chartType prop이 안 왔을 때만" 이 컴포넌트가 알아서 자체
// state로 관리 + 토글을 그린다(중복 UI 방지).
function ChartTypeToggle({ options, value, onChange }) {
  if (!options) return null;
  return (
    <div className="flex items-center gap-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          title={`${opt.label}로 표시`}
          className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
            value === opt.value
              ? "bg-dash-mint/25 text-dash-mint"
              : "text-dash-muted hover:text-dash-fg hover:bg-dash-surfaceAlt"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// 2026-07-16: "Log Volume" 카드 선 색을 사용자가 직접 바꿀 수 있게 - localStorage에
// 저장해서 새로고침/재방문해도 유지된다. useTheme.jsx의 STORAGE_KEY 패턴을 그대로 따름.
const LOGVOLUME_COLOR_STORAGE_KEY = "sentinel-ops-logvolume-colors";

function loadCustomLogVolumeColors(defaults) {
  if (typeof window === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(LOGVOLUME_COLOR_STORAGE_KEY);
    if (!raw) return defaults;
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

function useLogVolumeColors(defaults) {
  const [colors, setColors] = useState(() => loadCustomLogVolumeColors(defaults));
  const setColor = (key, value) => {
    setColors((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(LOGVOLUME_COLOR_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* localStorage를 못 쓰는 환경이면 이번 세션에서만 반영되고 저장은 안 됨 */
      }
      return next;
    });
  };
  const resetColors = () => {
    setColors(defaults);
    try {
      localStorage.removeItem(LOGVOLUME_COLOR_STORAGE_KEY);
    } catch {
      /* no-op */
    }
  };
  return [colors, setColor, resetColors];
}

// module을 안 넘기는 용법(Overview의 "Log Volume" 카드) 전용 - WAS/WAF/Falco/K8s
// Audit 4개 + 전체 총량까지 5개 선으로 쪼개서 보여준다("어느 소스가 볼륨을
// 주도하는지"가 총량 하나만으로는 안 보인다는 피드백, 2026-07-16). WAS/Falco/
// K8sAudit 상세 뷰는 이미 module을 하나로 좁혀서 이 컴포넌트를 재사용하므로,
// 거기서까지 이 breakdown을 켜면 이미 좁힌 모듈 하나 보겠다고 API를 4번 더
// 부르는 낭비가 생긴다 - 그래서 module 유무로 분기해서 별도 하위 컴포넌트로
// 뺐다(훅 호출 순서는 각 컴포넌트 인스턴스마다 고정이라 이렇게 나눠도 안전함).
function LogVolumeBreakdownBody({ rangeKey, kpiFilter = "ALL" }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const preset = RANGE_PRESETS.find((p) => p.key === rangeKey);
  const { pollMs } = usePollInterval();
  const sevParams = KPI_SEVERITY_PARAMS[kpiFilter] || {};

  const total = useLogVolume({ lookbackMs: preset.lookbackMs, bucketMs: preset.bucketMs, pollMs, ...sevParams });
  const was = useLogVolume({ lookbackMs: preset.lookbackMs, bucketMs: preset.bucketMs, module: "was", pollMs, ...sevParams });
  const waf = useLogVolume({ lookbackMs: preset.lookbackMs, bucketMs: preset.bucketMs, module: "waf", pollMs, ...sevParams });
  const falco = useLogVolume({ lookbackMs: preset.lookbackMs, bucketMs: preset.bucketMs, module: "falco", pollMs, ...sevParams });
  const k8s = useLogVolume({ lookbackMs: preset.lookbackMs, bucketMs: preset.bucketMs, module: "k8s_audit", pollMs, ...sevParams });

  const defaults = useMemo(
    () => ({
      total: DONUT_PALETTE[3],
      was: getModuleMeta("was").color,
      waf: getModuleMeta("waf").color,
      falco: getModuleMeta("falco").color,
      k8s_audit: getModuleMeta("k8s_audit").color,
    }),
    []
  );
  const [colors, setColor, resetColors] = useLogVolumeColors(defaults);

  const parts = [total, was, waf, falco, k8s];
  const status = parts.some((p) => p.status === "error")
    ? "error"
    : parts.every((p) => p.status === "ready")
      ? "ready"
      : "loading";

  const data = useMemo(() => {
    const len = total.buckets.length;
    const rows = [];
    for (let i = 0; i < len; i++) {
      const ts = total.buckets[i]?.ts;
      if (ts == null) continue;
      rows.push({
        label: formatBucketLabel(new Date(ts), preset.bucketMs),
        total: total.buckets[i]?.total ?? 0,
        was: was.buckets[i]?.total ?? 0,
        waf: waf.buckets[i]?.total ?? 0,
        falco: falco.buckets[i]?.total ?? 0,
        k8s_audit: k8s.buckets[i]?.total ?? 0,
      });
    }
    return rows;
  }, [total.buckets, was.buckets, waf.buckets, falco.buckets, k8s.buckets, preset.bucketMs]);

  const spike = useMemo(() => detectSpike(data.map((d) => d.total)), [data]);
  const spikePoint = spike ? data[spike.index] : null;

  // was/waf/falco/k8s_audit 4개는 Infrastructure의 "모듈별 로그량 추이"와 같은
  // 방식으로 그라디언트 채움 + 적층(stackId)해서 보여준다. total은 그 4개의
  // 합이라 같이 쌓으면 높이가 두 배로 왜곡되므로 스택엔 안 넣고, 위에 얇은
  // 오버레이 선(Line)으로만 그려서 급증 배지/기준선 역할을 유지한다
  // (2026-07-16: Infrastructure 쪽 디자인이 더 낫다는 피드백으로 LineChart 5선
  // → ComposedChart[stacked Area 4 + overlay Line 1]로 교체).
  const stackSeries = [
    { key: "was", label: "WAS" },
    { key: "waf", label: "WAF" },
    { key: "falco", label: "Falco" },
    { key: "k8s_audit", label: "K8s Audit" },
  ];
  const series = [{ key: "total", label: "전체" }, ...stackSeries];

  return (
    <Card
      title="Log Volume"
      subtitle={`Last ${preset.label} · ${data.length} buckets · 모듈별 구분${
        kpiFilter !== "ALL" ? ` · ${{ ERROR: "Errors", WARNING: "Warnings" }[kpiFilter] || kpiFilter} 필터` : ""
      }`}
      action={
        spike ? (
          <span className="text-[11px] font-medium px-2 py-1 rounded-md bg-dash-pink/15 text-dash-pink whitespace-nowrap">
            ⚠ {spikePoint.label} 평소 대비 +{spike.pctOverBaseline}% 급증
          </span>
        ) : null
      }
      className="h-80"
    >
      {status === "loading" && <p className="text-dash-muted text-xs">불러오는 중...</p>}
      {status === "error" && <p className="text-dash-critical text-xs">Log Volume을 불러오지 못했습니다.</p>}
      {status === "ready" && (
        <>
          <ResponsiveContainer width="100%" height="76%">
            <ComposedChart data={data}>
              <defs>
                {stackSeries.map((s) => (
                  <linearGradient key={s.key} id={`logVolumeFill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={colors[s.key]} stopOpacity={0.55} />
                    <stop offset="100%" stopColor={colors[s.key]} stopOpacity={0.05} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid stroke={C.surfaceAlt} vertical={false} />
              <XAxis dataKey="label" stroke={C.muted} tickLine={false} axisLine={false} fontSize={11} minTickGap={24} />
              <YAxis stroke={C.muted} tickLine={false} axisLine={false} fontSize={12} />
              <Tooltip contentStyle={tooltipStyle(C)} />
              {stackSeries.map((s) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stackId="module"
                  stroke={colors[s.key]}
                  fill={`url(#logVolumeFill-${s.key})`}
                  strokeWidth={1.5}
                />
              ))}
              <Line
                type="monotone"
                dataKey="total"
                name="전체"
                stroke={colors.total}
                strokeWidth={2.5}
                strokeDasharray="4 3"
                dot={false}
                isAnimationActive={false}
              />
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
            </ComposedChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap items-center gap-3 text-xs text-dash-muted mt-2">
            {series.map((s) => (
              <label
                key={s.key}
                title="클릭해서 이 선의 색을 직접 바꿀 수 있어요"
                className="relative flex items-center gap-1.5 cursor-pointer"
              >
                <span
                  className="w-2.5 h-2.5 rounded-full inline-block border border-dash-surfaceAlt"
                  style={{ backgroundColor: colors[s.key] }}
                />
                {s.label}
                <input
                  type="color"
                  value={colors[s.key]}
                  onChange={(e) => setColor(s.key, e.target.value)}
                  className="w-0 h-0 opacity-0 absolute"
                />
              </label>
            ))}
            <button
              onClick={resetColors}
              className="text-[11px] text-dash-faint hover:text-dash-muted underline underline-offset-2 ml-auto"
            >
              색상 초기화
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

export function LogVolumeChart({ rangeKey, module, kpiFilter = "ALL", chartType: chartTypeProp }) {
  // module 없이 호출되면(Overview) 5선 breakdown으로 위임 - 아래 기존 로직은
  // module이 특정된 상세 뷰(WAS/Falco/K8sAudit) 전용으로 계속 쓰인다.
  if (!module) {
    return <LogVolumeBreakdownBody rangeKey={rangeKey} kpiFilter={kpiFilter} />;
  }
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  // 2026-07-15: 형광 민트/critical 빨강이 "에러처럼 보인다"는 피드백 - Overview/
  // Incidents 도넛에서 이미 검증된 DONUT_PALETTE 톤으로 맞춘다. 전체 로그는
  // 차분한 스틸블루, Major~Critical(중요 로그)만 도넛의 빨강(테라코타) 톤으로
  // 구분되게 유지 - 이 두 색은 WAS/Falco/K8sAudit 상세 뷰도 이 컴포넌트를
  // 그대로 재사용하므로 전체 "계층별 로그" 차트에 다 같이 적용된다.
  const totalColor = DONUT_PALETTE[3];
  const errorColor = DONUT_PALETTE[0];
  const preset = RANGE_PRESETS.find((p) => p.key === rangeKey);
  const { pollMs } = usePollInterval();
  const [internalType, setInternalType] = useState(() => defaultChartTypeFor("log-volume"));
  const isControlled = chartTypeProp !== undefined;
  const chartType = isControlled ? chartTypeProp : internalType;
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
        <div className="flex items-center gap-2">
          {!isControlled && (
            <ChartTypeToggle options={chartTypeOptionsFor("log-volume")} value={chartType} onChange={setInternalType} />
          )}
          {spike && (
            <span className="text-[11px] font-medium px-2 py-1 rounded-md bg-dash-pink/15 text-dash-pink whitespace-nowrap">
              ⚠ {spikePoint.label} 평소 대비 +{spike.pctOverBaseline}% 급증
            </span>
          )}
        </div>
      }
      className={isControlled ? "min-h-80 h-full" : "h-80"}
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
                <Tooltip
                  contentStyle={{ background: C.surfaceAlt, border: "none", borderRadius: 8, color: C.fg }}
                  cursor={{ fill: C.surfaceAlt, opacity: 0.5 }}
                />
                <Bar dataKey="total" fill={totalColor} radius={[3, 3, 0, 0]} />
                <Bar dataKey="errorish" fill={errorColor} radius={[3, 3, 0, 0]} />
              </BarChart>
            ) : (
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="volumeFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={totalColor} stopOpacity={0.45} />
                    <stop offset="100%" stopColor={totalColor} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="errorFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={errorColor} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={errorColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={C.surfaceAlt} vertical={false} />
                <XAxis dataKey="label" stroke={C.muted} tickLine={false} axisLine={false} fontSize={11} minTickGap={24} />
                <YAxis stroke={C.muted} tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip contentStyle={tooltipStyle(C)} />
                <Area type="monotone" dataKey="total" stroke={totalColor} fill="url(#volumeFill)" strokeWidth={2} />
                <Area type="monotone" dataKey="errorish" stroke={errorColor} fill="url(#errorFill)" strokeWidth={2} />
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
              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: totalColor }} /> 전체 로그
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: errorColor }} /> Major~Critical
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

// 모듈별(WAS/WAF/Falco/K8s Audit) 로그량 추이 적층 그래프 - Log Volume 차트는
// 합산한 총량만 보여줘서 "지금 어느 소스가 볼륨을 주도하는지"가 안 보이던 문제.
// /stats/volume을 module별로 호출하면 서버가 같은 date_histogram 경계를 쓰므로
// 버킷 인덱스가 그대로 정렬돼 안전하게 합칠 수 있다. WAF는 2026-07-16 추가 -
// WAF 백엔드가 실제로 트래픽을 받기 시작하면서 이 차트에서만 빠져있던 게
// 눈에 띄어서 나머지 3개 모듈과 나란히 넣었다.
export function ModuleVolumeStackedChart({ fillHeight = false }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const [rangeKey, setRangeKey] = useState("24h");
  const preset = RANGE_PRESETS.find((p) => p.key === rangeKey);
  const { pollMs } = usePollInterval();

  const was = useLogVolume({ lookbackMs: preset.lookbackMs, bucketMs: preset.bucketMs, module: "was", pollMs });
  const waf = useLogVolume({ lookbackMs: preset.lookbackMs, bucketMs: preset.bucketMs, module: "waf", pollMs });
  const falco = useLogVolume({ lookbackMs: preset.lookbackMs, bucketMs: preset.bucketMs, module: "falco", pollMs });
  const k8s = useLogVolume({ lookbackMs: preset.lookbackMs, bucketMs: preset.bucketMs, module: "k8s_audit", pollMs });

  const parts = [was, waf, falco, k8s];
  const status = parts.some((p) => p.status === "error")
    ? "error"
    : parts.every((p) => p.status === "ready")
      ? "ready"
      : "loading";

  const data = useMemo(() => {
    const len = Math.max(was.buckets.length, waf.buckets.length, falco.buckets.length, k8s.buckets.length);
    const rows = [];
    for (let i = 0; i < len; i++) {
      const ts = was.buckets[i]?.ts ?? waf.buckets[i]?.ts ?? falco.buckets[i]?.ts ?? k8s.buckets[i]?.ts;
      if (ts == null) continue;
      rows.push({
        label: formatBucketLabel(new Date(ts), preset.bucketMs),
        was: was.buckets[i]?.total ?? 0,
        waf: waf.buckets[i]?.total ?? 0,
        falco: falco.buckets[i]?.total ?? 0,
        k8s_audit: k8s.buckets[i]?.total ?? 0,
      });
    }
    return rows;
  }, [was.buckets, waf.buckets, falco.buckets, k8s.buckets, preset.bucketMs]);

  const metaWas = getModuleMeta("was");
  const metaWaf = getModuleMeta("waf");
  const metaFalco = getModuleMeta("falco");
  const metaK8s = getModuleMeta("k8s_audit");

  return (
    <Card
      title="모듈별 로그량 추이"
      subtitle={`Last ${preset.label} · WAS / WAF / Falco / K8s Audit 적층`}
      action={<TimeRangePicker value={rangeKey} onChange={setRangeKey} />}
      className={fillHeight ? "min-h-80 h-full" : "h-80"}
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
                <linearGradient id="moduleWafFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={metaWaf.color} stopOpacity={0.55} />
                  <stop offset="100%" stopColor={metaWaf.color} stopOpacity={0.05} />
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
                dataKey="waf"
                name={metaWaf.label}
                stackId="module"
                stroke={metaWaf.color}
                fill="url(#moduleWafFill)"
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
            {[metaWas, metaWaf, metaFalco, metaK8s].map((m) => (
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
export function RealLevelDistributionChart({ hours, module, kpiFilter = "ALL", chartType: chartTypeProp }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const { pollMs } = usePollInterval();
  const [internalType, setInternalType] = useState(() => defaultChartTypeFor("level-distribution"));
  const isControlled = chartTypeProp !== undefined;
  const chartType = isControlled ? chartTypeProp : internalType;
  const sevParams = KPI_SEVERITY_PARAMS[kpiFilter] || {};
  const { levels, total, status, error } = useLogLevels({ hours, module, pollMs, ...sevParams });

  const data = REAL_SEVERITY_LEVELS.map((l, i) => {
    const found = levels.find((x) => x.severity === l.severity);
    return { key: l.key, label: l.label, count: found ? found.count : 0, color: DONUT_PALETTE[i % DONUT_PALETTE.length] };
  });
  const [activeIndex, setPaused] = useAutoCycleIndex(chartType === "donut" ? data.length : 0);

  return (
    <Card
      title="Log Levels"
      subtitle={
        status === "ready"
          ? `선택 구간 · ${total}건${kpiFilter !== "ALL" ? ` · ${{ ERROR: "Errors", WARNING: "Warnings" }[kpiFilter] || kpiFilter} 필터` : ""}`
          : "불러오는 중..."
      }
      action={
        !isControlled && (
          <ChartTypeToggle options={chartTypeOptionsFor("level-distribution")} value={chartType} onChange={setInternalType} />
        )
      }
      className={isControlled ? "min-h-80 h-full" : "h-80"}
    >
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
              <Tooltip contentStyle={tooltipStyle(C)} cursor={false} />
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
          <Tooltip
            contentStyle={{ background: C.surfaceAlt, border: "none", borderRadius: 8, color: C.fg }}
            cursor={{ fill: C.surfaceAlt, opacity: 0.5 }}
          />
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
  // 2026-07-16: 목록 높이는 "정확히 5줄" 크기(h-48)로 고정해서 그 이상은 항상
  // 내부 스크롤로만 보이게 한다. 이 카드는 오른쪽 컬럼(TopSources 위 +
  // ErrorRateGauge 아래)의 flex-col 안에서 자기 내용 높이만 차지하고, 남는
  // 세로 공간은 아래 ErrorRateGauge가 flex-1로 흡수해서 왼쪽 Recent Logs
  // 높이와 맞춘다(아래 grid 행의 stretch + flex-col 구조 참고).
  return (
    <Card
      title="Top Source IPs"
      subtitle={highlighted ? `전체 ${sources.length}개 IP · 5개 이후 스크롤` : "선택 구간 기준"}
      className={highlighted ? "glow-box-mint" : ""}
    >
      <div className="space-y-3 h-48 min-h-0 overflow-y-auto pr-1">
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

  // 2026-07-16: 오른쪽 컬럼(TopSources + 이 카드)이 왼쪽 Recent Logs와 같은 행에서
  // stretch되면, 이 카드가 flex-1로 남는 세로 공간을 전부 흡수한다 - 고정 140px
  // 차트+오버레이 블록은 그대로 두고, 그 블록을 담은 wrapper를 flex로 세로
  // 중앙정렬해서 늘어난 공간이 위아래로 고르게 여백처럼 보이게 했다(예전처럼
  // 카드 아래쪽에만 어색하게 빈 공간이 남지 않도록).
  return (
    <Card title={title} subtitle={subtitle} className="flex-1 flex flex-col">
      <div className="relative flex-1 flex items-center justify-center min-h-[140px]">
        <div className="relative w-full">
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
        </div>
      </div>
    </Card>
  );
}

function tooltipStyle(C) {
  // surfaceAlt가 순수 블랙에 가까운 다크 테마에서는 border:none이면 카드/페이지
  // 배경과 거의 구분이 안 돼(2026-07-16 피드백: "도넛 차트에 마우스를 대면
  // 검정색이라 잘 안 보임") - 옅은 테두리를 둬서 배경과 확실히 분리되게 한다.
  return { background: C.surfaceAlt, border: `1px solid ${C.faint}`, borderRadius: 8, color: C.fg, fontSize: 12 };
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
        <Tooltip contentStyle={tooltipStyle(C)} cursor={{ fill: C.surfaceAlt, opacity: 0.5 }} />
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
    // 2026-07-16: "%" 말고 "ms"/"건" 같은 다른 단위 접미사가 붙은 값("42ms",
    // "128건")도 여기 들어오는데, 예전엔 suffix를 "%"만 인식해서 애니메이션이
    // 시작되는 순간 단위가 사라지는 버그가 있었다("42ms" -> 애니메이션 중/후
    // "42"만 남음) - 꼬리의 숫자/콤마/마침표/공백이 아닌 문자열을 통째로
    // 접미사로 떼어내고, 남은 부분이 순수 숫자(콤마/소수점 허용)인지만 검사하도록
    // 일반화했다.
    const trimmed = String(rawValue).trim();
    const suffixMatch = trimmed.match(/[^\d,.\s]+$/);
    const numericPart = suffixMatch ? trimmed.slice(0, -suffixMatch[0].length).trim() : trimmed;
    const isPlainNumber = !Number.isNaN(numeric) && /^[\d,]+(\.\d+)?$/.test(numericPart);
    if (Number.isNaN(numeric) || !isPlainNumber) {
      setDisplay(rawValue);
      return;
    }
    const suffix = suffixMatch ? suffixMatch[0] : "";
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
function DetectionSourceDonutCompact({ lookbackMs, kpiFilter = "ALL", chartType: chartTypeProp }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const [internalType, setInternalType] = useState(() => defaultChartTypeFor("donut-source"));
  const isControlled = chartTypeProp !== undefined;
  const chartType = isControlled ? chartTypeProp : internalType;
  const sevParams = KPI_SEVERITY_PARAMS[kpiFilter] || {};
  const { byModule, status, error } = useDetectionSources({ lookbackMs, ...sevParams });
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
    <Card
      title="탐지 소스별 분포"
      subtitle={
        status === "ready"
          ? `WAS / Falco / K8s Audit · 총 ${total}건${kpiFilter !== "ALL" ? ` · ${{ ERROR: "Errors", WARNING: "Warnings" }[kpiFilter] || kpiFilter} 필터` : ""}`
          : "불러오는 중..."
      }
      action={
        !isControlled && (
          <ChartTypeToggle options={chartTypeOptionsFor("donut-source")} value={chartType} onChange={setInternalType} />
        )
      }
      className={isControlled ? "min-h-80 h-full" : ""}
    >
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
              <Tooltip contentStyle={tooltipStyle(C)} cursor={false} />
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
function SeverityDonutCompact({ hours, chartType: chartTypeProp }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const { pollMs } = usePollInterval();
  const [internalType, setInternalType] = useState(() => defaultChartTypeFor("donut-severity"));
  const isControlled = chartTypeProp !== undefined;
  const chartType = isControlled ? chartTypeProp : internalType;
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
    <Card
      title="심각도 분포"
      subtitle={status === "ready" ? `선택 구간 · 총 ${total}건` : "불러오는 중..."}
      action={
        !isControlled && (
          <ChartTypeToggle options={chartTypeOptionsFor("donut-severity")} value={chartType} onChange={setInternalType} />
        )
      }
      className={isControlled ? "min-h-80 h-full" : ""}
    >
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
              <Tooltip contentStyle={tooltipStyle(C)} cursor={false} />
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

// 계층별 공격 통계 — GET /scenarios(hit_count 포함, scenarios_api.py)를 재사용해서
// "어떤 공격이 많이 들어왔는지"를 계층(WAS/WAF/Falco/K8s Audit)별로 색상 구분해서
// 보여준다. 2026-07-17: "K8s 네임스페이스별 분포는 필요 없다, 계층별 공격 통계로
// 바꿔달라" 피드백으로 이 카드가 있던 자리(위젯 타입은 donut-k8s-namespace 그대로
// 유지 - 저장된 커스텀 대시보드가 이 슬롯을 참조 중일 수 있어 타입 키를 바꾸면
// 그 대시보드에서만 위젯이 사라진다)를 교체했다. required_modules[0](YAML에서
// 시나리오가 요구하는 첫 모듈)을 그 시나리오의 "계층"으로 취급 - AdminAuditView의
// "탐지 룰별 적중 랭킹"과 같은 hit_count 소스지만, 여기는 전역 랭킹이 아니라
// 계층별 색상 구분 + 계층별 합계 요약이 핵심이라 별도로 뺐다.
//
// scenarios/status/error는 props로 받는다(자체 useScenarios() 호출 안 함) - 같은
// /scenarios 응답을 "탐지 시나리오" KPI 카드(kpi-sources, 2026-07-17 "Active
// Sources를 탐지 가능한 시나리오 개수로" 피드백으로 추가)도 필요로 해서, 부모
// (DashboardContent)가 한 번만 fetch해 두 위젯에 같이 내려준다 - Overview
// 기본 모드에선 이 위젯과 KPI 카드가 항상 동시에 보이므로, 각자 훅을 부르면
// /scenarios가 매번 두 번 나간다.
const LAYER_ORDER = ["was", "waf", "falco", "k8s_audit"];

function LayerAttackStatsCompact({ scenarios, status, error }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];

  const ranked = useMemo(
    () =>
      scenarios
        .filter((s) => s.hit_count > 0)
        .map((s) => {
          const module = s.required_modules?.[0] || "unknown";
          const meta = getModuleMeta(module);
          return { key: s.id, name: s.name, hits: s.hit_count, module, moduleLabel: meta.label, color: meta.color, mitre: s.mitre_technique_id };
        })
        .sort((a, b) => b.hits - a.hits),
    [scenarios]
  );
  const top = ranked.slice(0, 6);
  const totalHits = ranked.reduce((sum, r) => sum + r.hits, 0);

  const layerTotals = useMemo(() => {
    const byModule = {};
    ranked.forEach((r) => {
      byModule[r.module] = (byModule[r.module] || 0) + r.hits;
    });
    return LAYER_ORDER.map((m) => ({ module: m, ...getModuleMeta(m), count: byModule[m] || 0 }));
  }, [ranked]);

  return (
    <Card
      title="계층별 공격 통계"
      subtitle={status === "ready" ? `전체 기간 · 발화 시나리오 ${ranked.length}개 · 총 ${totalHits}건` : "불러오는 중..."}
    >
      {status === "error" && <p className="text-dash-critical text-xs">{error}</p>}
      {status === "ready" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {layerTotals.map((l) => (
              <span key={l.module} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ backgroundColor: l.color }} />
                <span className="text-dash-muted">{l.label}</span>
                <span className="text-dash-fg font-medium">{l.count}</span>
              </span>
            ))}
          </div>
          {top.length === 0 ? (
            <p className="text-dash-muted text-xs">아직 발화된 공격이 없습니다.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(150, top.length * 32)}>
              <BarChart data={top} layout="vertical" margin={{ left: 4, right: 24, top: 4, bottom: 4 }}>
                <CartesianGrid stroke={C.surfaceAlt} horizontal={false} />
                <XAxis type="number" stroke={C.muted} tickLine={false} axisLine={false} fontSize={10} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  stroke={C.muted}
                  tickLine={false}
                  axisLine={false}
                  fontSize={10}
                  width={110}
                  tickFormatter={(v) => (v.length > 13 ? `${v.slice(0, 13)}…` : v)}
                />
                <Tooltip
                  contentStyle={{ background: C.surface, border: `1px solid ${C.surfaceAlt}`, borderRadius: 8, fontSize: 12, color: C.fg }}
                  cursor={{ fill: C.surfaceAlt, opacity: 0.5 }}
                  formatter={(value, _name, item) => [`${value}건`, item?.payload?.moduleLabel ?? "적중 건수"]}
                  labelFormatter={(label, payload) => payload?.[0]?.payload?.name ?? label}
                />
                <Bar dataKey="hits" radius={[0, 6, 6, 0]} isAnimationActive animationDuration={700} animationEasing="ease-out">
                  {top.map((d) => (
                    <Cell key={d.key} fill={d.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
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
// countries는 도시 단위 포인트라(2026-07-16, GeoLite2-City 도입) 같은 나라가 여러
// 개 있을 수 있다 - 부제의 "N개국"은 countries.length가 아니라 countryCode
// distinct count로 센다.
function GeoSummaryCard() {
  const { theme } = useTheme();
  const { countries, status, error } = useGeoStats({ limit: 50 });
  const total = countries.reduce((s, c) => s + c.count, 0);
  const countryCount = new Set(countries.map((c) => c.countryCode)).size;
  // 2026-07-17(7차): "Infrastructure처럼 Overview 지도도 2D/3D 토글로 바꿀 수
  // 있게 해달라" - Infrastructure 패널과 같은 2D(Google Maps)/3D(지구본) 전환을
  // 여기도 그대로 적용. 기본은 지금까지 써왔던 3D(지구본)를 유지해서 랜딩 화면의
  // "화려한" 첫인상은 그대로 두고, 자세히 보고 싶을 때만 2D로 바꾸게 했다.
  const [mapMode, setMapMode] = useState("3d");

  return (
    <Card
      title="공격 발원지 (GeoIP)"
      subtitle={
        mapMode === "3d"
          ? `전체 기간 · ${countryCount}개국 · 총 ${total}건 · 드래그로 회전`
          : `전체 기간 · ${countryCount}개국 · 총 ${total}건 · 스크롤로 확대`
      }
      action={
        <div className="flex items-center gap-1 shrink-0 bg-dash-surfaceAlt rounded-lg p-0.5">
          {[
            { key: "2d", label: "2D" },
            { key: "3d", label: "3D" },
          ].map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setMapMode(opt.key)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                mapMode === opt.key ? "bg-dash-fg text-dash-bg" : "text-dash-muted hover:text-dash-fg"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      }
    >
      {status === "error" && <p className="text-dash-critical text-xs mb-2">{error}</p>}
      {/* 2026-07-16(6차): 지구본이 카드 하단에서 살짝 잘린다는 피드백 - h-80(320px)
          에서 조금만 늘렸다. */}
      <div className="h-[360px]">
        {mapMode === "2d" ? (
          <GoogleGeoMap points={countries} />
        ) : (
          <Suspense fallback={<div className="w-full h-full flex items-center justify-center text-dash-faint text-xs">지구본 로딩 중...</div>}>
            <Globe3D points={countries} theme={theme} />
          </Suspense>
        )}
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
    <Card title="API Latency" subtitle={stats ? "요청이 처리되기까지 걸린 시간이에요 (숫자가 작을수록 빠른 거예요)" : "데이터 없음"}>
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
      className="h-full"
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

// 2026-07-17: "KPI 카드 눌러도 Log Volume/Log Levels/탐지 소스 분포 차트가 안
// 바뀐다" 피드백으로 /stats, /stats/volume, /stats/levels에 min_severity(">=")/
// severity(정확히 일치) 쿼리 파라미터를 새로 추가했다(stats_api.py의
// _severity_filters 참고) - 이 세 엔드포인트는 /logs와 달리 서버에서 exact
// severity로도 바로 걸러주므로, 위 KPI_MIN_SEVERITY(WARNING을 ">= 2"로 보내고
// 클라이언트에서 다시 좁히는 /logs 전용 우회)와는 별개로 이 맵을 쓴다.
const KPI_SEVERITY_PARAMS = {
  ALL: {},
  ERROR: { minSeverity: REAL_ERROR_MIN_SEVERITY },
  WARNING: { severity: REAL_WARNING_SEVERITY },
  SOURCES: {},
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
// 2026-07-15: 상시 보이는 테두리 박스 + 헤더바가 "위젯 배치를 다듬는 화면인데도
// 실제 위젯이 아니라 틀이 도드라져 보인다"는 피드백 — 평상시엔 완전히 투명해서
// 위젯 자체(Card/KpiCard 등이 이미 갖고 있는 배경/테두리)만 보이게 하고, 드래그
// 핸들/차트타입 버튼/제거 버튼은 마우스를 올렸을 때만 우상단에 작은 플로팅
// 툴바로 뜨도록 바꿨다 - 평소엔 기본 모드와 완전히 똑같이 보인다.
function WidgetFrame({ widgetType, title, chartType, onChartTypeChange, onRemove, children }) {
  const options = chartTypeOptionsFor(widgetType);

  return (
    <div className="group relative h-full w-full">
      <div className="h-full w-full overflow-auto">{children}</div>
      <div
        className="widget-drag-handle cursor-move absolute top-1.5 right-1.5 z-10 flex items-center gap-1.5 max-w-[92%] px-2 py-1 rounded-lg bg-dash-bg/95 border border-dash-mint/25 shadow-lg text-dash-muted text-[10px] uppercase tracking-wide select-none opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150"
      >
        <span className="opacity-70 tracking-tighter shrink-0">⠿⠿</span>
        <span className="truncate">{title}</span>
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
                    : "text-dash-muted hover:text-dash-fg hover:bg-dash-surfaceAlt"
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
function CustomDashboardView({ dashboard, renderWidgetContent, onLayoutCommit, onChartTypeCommit }) {
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
  // 2026-07-16: 상단 토글 버튼에서 "N hits" 표시를 뺐으므로 이 카운트는 더 이상
  // 화면에 안 쓰지만, onResultsCountChange 콜백 배선(SearchDiscoverView가 검색
  // 결과 수를 부모에 알려주는 통로) 자체는 나중에 다시 쓸 수도 있어 그대로 둔다.
  const [, setSearchHits] = useState(0);
  const preset = RANGE_PRESETS.find((p) => p.key === rangeKey);
  const hours = preset.lookbackMs / (60 * 60 * 1000);
  const { pollMs } = usePollInterval();

  // GET /stats/kpi — 상단 4개 KPI 카드(Total/Errors/Warnings/탐지 시나리오 +
  // 이전 구간 대비 델타). pollMs로 갱신(기본 2초, Admin 페이지에서 커스텀 가능) —
  // 더미 로그 생성기 돌릴 때 화면이 수동 새로고침 없이 따라 올라가야 한다는 피드백 반영.
  const { data: kpi, status: kpiStatus } = useKpi({ hours, pollMs });

  // GET /scenarios — 2026-07-17: 4번째 KPI 카드를 "Active Sources"(distinct
  // event.module 개수, 사실상 항상 WAS/WAF/Falco/K8s Audit 4로 고정이라 정보값이
  // 없다는 피드백)에서 "탐지 시나리오"(지금 켜져있는 상관 시나리오 개수)로
  // 바꿨다. 같은 응답을 "계층별 공격 통계" 위젯(LayerAttackStatsCompact)도 쓰므로
  // 여기서 한 번만 fetch해서 둘 다에 내려준다.
  const { scenarios, status: scenariosStatus, error: scenariosError } = useScenarios();
  const enabledScenarioCount = scenarios.filter((s) => s.enabled).length;
  const totalScenarioCount = scenarios.length;

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
            value={kpiStatus === "ready" ? `${(kpi.current.total ?? 0).toLocaleString()}건` : "-"}
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
            value={kpiStatus === "ready" ? `${(kpi.current.errors ?? 0).toLocaleString()}건` : "-"}
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
            value={kpiStatus === "ready" ? `${(kpi.current.warnings ?? 0).toLocaleString()}건` : "-"}
            delta={kpiStatus === "ready" && kpi.delta_pct.warnings != null ? `${Math.abs(kpi.delta_pct.warnings)}%` : undefined}
            positive={kpiStatus === "ready" ? (kpi.delta_pct.warnings ?? 0) <= 0 : true}
            onClick={() => setKpiFilter("WARNING")}
            active={kpiFilter === "WARNING"}
          />
        );
      case "kpi-sources":
        return (
          <KpiCard
            label="탐지 시나리오"
            value={scenariosStatus === "ready" ? `${enabledScenarioCount}/${totalScenarioCount}개` : "-"}
            onClick={() => setKpiFilter("SOURCES")}
            active={kpiFilter === "SOURCES"}
          />
        );
      case "log-volume":
        return <LogVolumeChart rangeKey={rangeKey} kpiFilter={kpiFilter} chartType={chartType || "area"} />;
      case "level-distribution":
        return <RealLevelDistributionChart hours={hours} kpiFilter={kpiFilter} chartType={chartType || "bar"} />;
      case "donut-source":
        return <DetectionSourceDonutCompact lookbackMs={preset.lookbackMs} kpiFilter={kpiFilter} chartType={chartType || "donut"} />;
      case "donut-severity":
        return <SeverityDonutCompact hours={hours} chartType={chartType || "donut"} />;
      case "donut-k8s-namespace":
        return <LayerAttackStatsCompact scenarios={scenarios} status={scenariosStatus} error={scenariosError} />;
      case "latency-stats":
        return <LatencyStatsPanel events={wasEventsForLatency} />;
      case "module-volume":
        return <ModuleVolumeStackedChart fillHeight />;
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
      value={kpiStatus === "ready" ? `${(kpi.current.total ?? 0).toLocaleString()}건` : "-"}
      delta={kpiStatus === "ready" && kpi.delta_pct.total != null ? `${Math.abs(kpi.delta_pct.total)}%` : undefined}
      positive={kpiStatus === "ready" ? (kpi.delta_pct.total ?? 0) >= 0 : true}
      onClick={() => setKpiFilter("ALL")}
      active={kpiFilter === "ALL"}
    />
  );
  const kpiErrorsWidget = (
    <KpiCard
      label="Errors (Major~Critical)"
      value={kpiStatus === "ready" ? `${(kpi.current.errors ?? 0).toLocaleString()}건` : "-"}
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
      value={kpiStatus === "ready" ? `${(kpi.current.warnings ?? 0).toLocaleString()}건` : "-"}
      delta={kpiStatus === "ready" && kpi.delta_pct.warnings != null ? `${Math.abs(kpi.delta_pct.warnings)}%` : undefined}
      positive={kpiStatus === "ready" ? (kpi.delta_pct.warnings ?? 0) <= 0 : true}
      onClick={() => setKpiFilter("WARNING")}
      active={kpiFilter === "WARNING"}
    />
  );
  const kpiSourcesWidget = (
    <KpiCard
      label="탐지 시나리오"
      value={scenariosStatus === "ready" ? `${enabledScenarioCount}/${totalScenarioCount}개` : "-"}
      onClick={() => setKpiFilter("SOURCES")}
      active={kpiFilter === "SOURCES"}
    />
  );
  const logVolumeWidget = <LogVolumeChart rangeKey={rangeKey} kpiFilter={kpiFilter} />;
  const levelDistributionWidget = <RealLevelDistributionChart hours={hours} kpiFilter={kpiFilter} />;
  const donutSourceWidget = <DetectionSourceDonutCompact lookbackMs={preset.lookbackMs} kpiFilter={kpiFilter} />;
  const donutSeverityWidget = <SeverityDonutCompact hours={hours} />;
  const donutK8sWidget = <LayerAttackStatsCompact scenarios={scenarios} status={scenariosStatus} error={scenariosError} />;
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
      {/* SearchDiscoverView + 위젯설정 행을 space-y-3(12px)짜리 별도 묶음으로
          감싸서, 바깥 space-y-6(24px) 리듬에서 이 둘만 빼왔다(2026-07-16) -
          한 줄짜리 얇은 행인데 위아래로 24px씩 비어 보여서 공백이 과하다는
          피드백. 이 묶음 자체는 바깥 space-y-6의 한 항목으로 취급되니 KPI
          카드 행과의 간격은 그대로 24px 유지됨. */}
      <div className="space-y-3">
        <SearchDiscoverView
          rangeKey={rangeKey}
          onRangeChange={setRangeKey}
          expanded={searchExpanded}
          setExpanded={setSearchExpanded}
          onResultsCountChange={setSearchHits}
        />

        {/* 위젯 설정 메뉴 + (커스텀 대시보드 보는 중이면) 위젯 편집 버튼 + 검색
            결과 펼치기 토글을 한 행에 둔다. 검색 결과 펼치기는 grid-cols-3의
            가운데 칸에 justify-self-center로 둬서 왼쪽 버튼 그룹 폭과 무관하게
            항상 행 중앙에 오도록 했다(2026-07-16, 예전엔 ml-auto로 우측 끝에
            붙어있었음). "N hits" 숫자는 버튼에서 뺐다 - 펼치면 패널 안에 어차피
            다시 나오는 정보라 버튼 라벨에까지 중복으로 넣을 필요가 없었다. */}
        <div className="grid grid-cols-3 items-center gap-3">
          <div className="flex items-center gap-3">
            <WidgetSettingsMenu
              dashboards={dashboards}
              activeId={activeId}
              setActiveId={setActiveId}
              deleteDashboard={deleteDashboard}
              onCreateNew={openNewBuilder}
              onEditActive={openEditBuilder}
            />
            {activeDashboard && (
              <button
                onClick={() => openEditBuilder(activeDashboard.id)}
                className="text-xs font-medium px-3 py-1.5 rounded-lg text-dash-muted hover:text-dash-fg hover:bg-dash-surfaceAlt transition-colors"
              >
                위젯 편집
              </button>
            )}
          </div>
          <button
            onClick={() => setSearchExpanded((e) => !e)}
            title={searchExpanded ? "검색 결과 패널 접기" : "검색 결과 패널 펼치기"}
            className={`justify-self-center inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
              searchExpanded
                ? "bg-dash-mint/15 text-dash-mint"
                : "text-dash-muted hover:text-dash-fg hover:bg-dash-surfaceAlt"
            }`}
          >
            검색 결과 {searchExpanded ? "접기" : "펼치기"}
            <span>{searchExpanded ? "▴" : "▾"}</span>
          </button>
          <div />
        </div>
      </div>

      {kpiFilter !== "ALL" && (
        <p className="text-dash-faint text-[11px]">
          {{ ERROR: "Errors", WARNING: "Warnings", SOURCES: "탐지 시나리오" }[kpiFilter]} 필터 적용 중 —{" "}
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
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-4">
            {kpiTotalWidget}
            {kpiErrorsWidget}
            {kpiWarningsWidget}
            {kpiSourcesWidget}
          </div>

          {/* 2026-07-16(8차): "실시간 활동 흐름 / 상관 흐름 둘 다 별로였다"는
              직접 피드백으로 두 위젯과 이 행 전체를 제거했다. */}

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

          {/* 2026-07-16: items-start를 걷어내고 기본 stretch로 되돌렸다 - 대신
              오른쪽 컬럼을 flex-col로 바꿔서 ErrorRateGauge가 flex-1로 남는
              세로 공간을 흡수하게 했다. 그래서 오른쪽 컬럼 전체 높이가 항상
              왼쪽 Recent Logs 높이와 같아지고(stretch), 그 차이만큼의 여백도
              ErrorRateGauge 카드 안에서 자연스러운 위아래 패딩으로 흡수돼서
              카드 바깥에 어색한 빈 공간이 남지 않는다. */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2">{recentLogsWidget}</div>
            <div className="flex flex-col gap-6">
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
    <div className="flex min-h-screen bg-dash-bg">
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
