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
import {
  AreaChart as AreaChartIcon,
  BarChart3,
  PieChart as PieChartIcon,
  TrendingUp,
  Layers,
  SlidersHorizontal,
  Crosshair,
  Gauge,
  Boxes,
  MapPin,
  ScrollText,
  AlertTriangle,
} from "lucide-react";
import { latencyStatsFor, levelDistributionFor } from "../data/mockLogs";
import { useTopIps } from "../hooks/useTopIps";
import { useKpi } from "../hooks/useKpi";
import { useLogVolume } from "../hooks/useLogVolume";
import { useLogLevels } from "../hooks/useLogLevels";
import { useDetectionSources } from "../hooks/useDetectionSources";
import { useLogs } from "../hooks/useLogs";
import { usePersistedOverviewLogRange } from "../hooks/usePersistedLogRange";
import { REAL_SEVERITY_LEVELS, REAL_ERROR_MIN_SEVERITY, REAL_WARNING_SEVERITY, getRealSeverityMeta } from "../data/realSeverity";
import { getModuleMeta } from "../data/moduleMeta";
import { useLiveAttackFeed } from "../hooks/useLiveFeed";
import { ALL_LEVELS, ERROR_BAND, WARN_BAND, getLevelMeta, getDisplayTier } from "../data/logLevels";
import { RANGE_PRESETS, formatBucketLabel, detectSpike } from "../data/timeSeries";
import { usePollInterval } from "../context/PollIntervalContext";
import { CHART_COLORS, forTheme, DONUT_PALETTE, donutPalette, chartTooltipProps } from "../data/theme";
import { useTheme } from "../hooks/useTheme";
import { usePersistedPreference } from "../hooks/usePersistedPreference";
import { DISPLAY_TIMEZONE } from "../lib/timezone";
import SearchDiscoverView from "./SearchDiscoverView";
import TimeRangePicker from "../components/TimeRangePicker";
import GoogleGeoMap from "../components/GoogleGeoMap";
import { ChartHoverPanel, RechartsHoverPanel } from "../components/HoverPanel";
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

export function Card({ title, subtitle, icon: Icon, action, children, className = "" }) {
  return (
    <div className={`bg-dash-surface rounded-2xl p-5 ${className}`}>
      {(title || action) && (
        <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
          <div>
            {title && (
              <h3 className="flex items-center gap-1.5 text-dash-fg text-sm font-semibold">
                {Icon && <Icon size={15} className="text-dash-muted shrink-0" />}
                {title}
              </h3>
            )}
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
export function KpiCard({ label, labelSuffix, value, delta, positive = true, onClick, active = false, accent = "mint", labelTone }) {
  const { theme } = useTheme();
  const Tag = onClick ? "button" : "div";
  const accentBorder = accent === "critical" ? "border-dash-critical/50" : "border-dash-mint/50";
  // KPI 라벨은 라이트에서 원색을 유지하고, 다크에서는 같은 색을 살짝 눌러
  // 눈부심 없이 다른 차트의 다크 팔레트와 맞춘다.
  const labelBaseColor = labelTone === "sky" ? "#38BDF8" : CHART_COLORS.light[labelTone];
  const labelColor = labelBaseColor
    ? (theme === "dark" ? forTheme(labelBaseColor, "light") : labelBaseColor)
    : undefined;
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
      <p className="text-dash-muted text-xs mb-2">
        <span style={labelColor ? { color: labelColor } : undefined}>{label}</span>
        {labelSuffix && <span className="text-dash-fg">{labelSuffix}</span>}
      </p>
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
// 차트 타입 아이콘 - lucide에 도형이 그대로 있는 3종(영역/막대/도넛)이라 라벨과
// 1:1로 맞아떨어진다(2026-07-18 아이콘 스캔 후 적용). recharts의 동명 컴포넌트
// (AreaChart/PieChart)와 이름이 겹쳐서 import 시 별칭(AreaChartIcon/PieChartIcon)을
// 붙였다 - 여기서만 그 별칭을 실제로 사용.
const CHART_TYPE_ICONS = { area: AreaChartIcon, bar: BarChart3, donut: PieChartIcon };

function ChartTypeToggle({ options, value, onChange }) {
  if (!options) return null;
  return (
    <div className="flex items-center gap-0.5">
      {options.map((opt) => {
        const Icon = CHART_TYPE_ICONS[opt.value];
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            title={`${opt.label}로 표시`}
            className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors ${
              value === opt.value
                ? "bg-dash-mint/25 text-dash-mint"
                : "text-dash-muted hover:text-dash-fg hover:bg-dash-surfaceAlt"
            }`}
          >
            {Icon && <Icon size={11} strokeWidth={2.5} />}
            {opt.label}
          </button>
        );
      })}
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
function LogVolumeBreakdownBody({ rangeKey, kpiFilter = "ALL", isControlled = false }) {
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
      total: donutPalette(theme)[3],
      was: getModuleMeta("was").color,
      waf: getModuleMeta("waf").color,
      falco: getModuleMeta("falco").color,
      k8s_audit: getModuleMeta("k8s_audit").color,
    }),
    [theme]
  );
  const [colors, setColor, resetColors] = useLogVolumeColors(defaults);

  const parts = [total, was, waf, falco, k8s];
  const status = parts.some((p) => p.status === "error")
    ? "error"
    : parts.every((p) => p.status === "ready")
      ? "ready"
      : "loading";

  const data = useMemo(() => {
    // total/was/waf/falco/k8s는 각자 독립된 GET /stats/volume 요청이라(useLogVolume
    // 훅 5개, 각자 자기만의 usePoll 타이머) 서버가 매 요청마다 새로 계산하는 now
    // 기준으로 버킷 범위(extended_bounds)가 정해진다 - 요청 타이밍이 조금만
    // 어긋나도(네트워크 지연 등) 한 시리즈만 맨 끝 버킷이 하나 더 있거나 없을 수
    // 있다. 예전엔 인덱스로만 짝을 맞춰서(total.buckets[i] <-> was.buckets[i])
    // 그런 경우 서로 다른 시각대 값이 같은 라벨 아래 그려질 위험이 있었다
    // (2026-07-21) - ts(버킷 경계, OpenSearch date_histogram의 고정 grid라 값 자체는
    // 시리즈 간에 항상 일치)로 직접 매칭해서, 특정 시리즈에 그 ts의 버킷이 아예
    // 없으면(있어야 할 값을 다른 시각의 값으로 잘못 채우는 대신) 0으로 표시한다.
    const byTs = (buckets) => new Map(buckets.map((b) => [b.ts, b.total]));
    const wasByTs = byTs(was.buckets);
    const wafByTs = byTs(waf.buckets);
    const falcoByTs = byTs(falco.buckets);
    const k8sByTs = byTs(k8s.buckets);

    return total.buckets
      .filter((b) => b.ts != null)
      .map((b) => ({
        label: formatBucketLabel(new Date(b.ts), preset.bucketMs),
        total: b.total ?? 0,
        was: wasByTs.get(b.ts) ?? 0,
        waf: wafByTs.get(b.ts) ?? 0,
        falco: falcoByTs.get(b.ts) ?? 0,
        k8s_audit: k8sByTs.get(b.ts) ?? 0,
      }));
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
      icon={TrendingUp}
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
      // 커스텀 대시보드(위젯 박스 리사이즈 가능)에서는 min-h-80 h-full로 그리드
      // 셀 실제 높이를 그대로 채운다 - 여기가 isControlled를 안 받고 항상
      // h-80(320px) 고정이었던 게 실제 버그였다: WIDGET_CATALOG의 log-volume
      // h:14(실측 488px)는 이 컴포넌트가 그 공간을 다 쓴다는 전제로 잡힌
      // 값인데, module 없이 호출되는 Overview 버전(이 함수)만 그 실측 대상인
      // LogVolumeChart의 module 갈래(위, isControlled 배선 있음)와 다르게
      // isControlled 배선이 아예 빠져 있어서 항상 320px에 멈추고 나머지는
      // 빈 여백으로 남았다(2026-07-23, 스크린샷/녹화로 재현 확인).
      className={isControlled ? "min-h-80 h-full flex flex-col" : "h-80 flex flex-col"}
    >
      {status === "loading" && <p className="text-dash-muted text-xs">불러오는 중...</p>}
      {status === "error" && <p className="text-dash-critical text-xs">Log Volume을 불러오지 못했습니다.</p>}
      {status === "ready" && (
        <>
          {/* 2026-07-19: 고정 비율(height="76%")로는 범례 줄(아래 flex-wrap 행)이
              길어져서 2줄로 접힐 때(모듈 5개 + "색상 초기화" 버튼이 좁은 폭에서
              흔히 그럼) 그 몫만큼을 안 빼주니까 Card의 고정 h-80을 넘어 카드
              밖으로 글자가 삐져나왔다(Card 자체엔 overflow 제어가 없음) - Card를
              flex-col로 바꾸고 차트를 flex-1 min-h-0으로 줘서, 범례가 먼저 자기
              콘텐츠 높이(몇 줄이든)를 그대로 확보하고 차트가 나머지 공간만
              쓰게 한다. */}
          <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
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
              <Tooltip content={<RechartsHoverPanel theme={theme} />} isAnimationActive={false} />
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
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-dash-muted mt-2 shrink-0">
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
  // module이 특정된 상세 뷰(WAS/Falco/K8sAudit) 전용으로 계속 쓰인다. 이 분기를
  // 훅 호출들보다 먼저 두면(예전 버전) module 값에 따라 이 컴포넌트가 매 렌더마다
  // 다른 개수의 훅을 호출하게 돼 React Hooks 규칙 위반이다(react-hooks/rules-of-hooks,
  // 2026-07-20 실측 확인) - 같은 컴포넌트 인스턴스가 module을 바꿔가며 리렌더되면
  // "Rendered fewer/more hooks than expected" 크래시로 이어질 수 있어 훅 호출을
  // 전부 마친 뒤로 옮긴다.
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  // 2026-07-15: 형광 민트/critical 빨강이 "에러처럼 보인다"는 피드백 - Overview/
  // Incidents 도넛에서 이미 검증된 DONUT_PALETTE 톤으로 맞춘다. 전체 로그는
  // 차분한 스틸블루, Major~Critical(중요 로그)만 도넛의 빨강(테라코타) 톤으로
  // 구분되게 유지 - 이 두 색은 WAS/Falco/K8sAudit 상세 뷰도 이 컴포넌트를
  // 그대로 재사용하므로 전체 "계층별 로그" 차트에 다 같이 적용된다.
  const totalColor = donutPalette(theme)[3];
  const errorColor = donutPalette(theme)[0];
  const preset = RANGE_PRESETS.find((p) => p.key === rangeKey);
  const { pollMs } = usePollInterval();
  const [internalType, setInternalType] = usePersistedPreference("sentinel-ops:chart-type:log-volume", defaultChartTypeFor("log-volume"), ["area", "bar", "donut"]);
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

  if (!module) {
    return <LogVolumeBreakdownBody rangeKey={rangeKey} kpiFilter={kpiFilter} isControlled={isControlled} />;
  }

  return (
    <Card
      title="Log Volume"
      icon={TrendingUp}
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
      className={isControlled ? "min-h-80 h-full flex flex-col" : "h-80 flex flex-col"}
    >
      {status === "loading" && <p className="text-dash-muted text-xs">불러오는 중...</p>}
      {status === "error" && <p className="text-dash-critical text-xs">{error}</p>}
      {status === "ready" && (
        <>
          {/* 2026-07-19: WAS/WAF/Falco/K8s Audit 상세 페이지가 쓰는 module 지정
              버전 - Overview 전용 LogVolumeBreakdownBody/ModuleVolumeStackedChart와
              같은 버그(고정 비율 height + flex-wrap 없는 범례가 카드 밖으로
              삐져나옴)가 이 갈래엔 안 고쳐진 채 남아있었다. 급증 배지까지 켜지면
              범례가 3개(전체 로그/Major~Critical/급증 구간)라 더 쉽게 넘쳤다. */}
          <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            {chartType === "bar" ? (
              <BarChart data={data}>
                <CartesianGrid stroke={C.surfaceAlt} vertical={false} />
                <XAxis dataKey="label" stroke={C.muted} tickLine={false} axisLine={false} fontSize={11} minTickGap={24} />
                <YAxis stroke={C.muted} tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip
                  content={<ChartHoverPanel theme={theme} />}
                  allowEscapeViewBox={{ x: true, y: true }}
                  reverseDirection={{ x: false, y: false }}
                  offset={0}
                  isAnimationActive={false}
                  wrapperStyle={{ pointerEvents: "none" }}
                  cursor={false}
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
                <Tooltip {...chartTooltipProps(C)} />
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
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-dash-muted mt-2 shrink-0">
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
      icon={Layers}
      subtitle={`Last ${preset.label} · WAS / WAF / Falco / K8s Audit 적층`}
      action={<TimeRangePicker value={rangeKey} onChange={setRangeKey} />}
      className={fillHeight ? "min-h-80 h-full flex flex-col" : "h-80 flex flex-col"}
    >
      {status === "loading" && <p className="text-dash-muted text-xs">불러오는 중...</p>}
      {status === "error" && <p className="text-dash-critical text-xs">모듈별 로그량을 불러오지 못했습니다.</p>}
      {status === "ready" && (
        <>
          {/* 2026-07-19: LogVolumeBreakdownBody와 같은 버그 - 고정 비율(height="82%")
              로는 아래 범례 행이 필요로 하는 높이를 안 빼주고, 게다가 이 범례 행은
              flex-wrap조차 없어서 좁은 폭에서는 줄바꿈도 안 되고 그냥 오른쪽/아래로
              넘쳤다(Card에 overflow 제어가 없어 카드 밖으로 삐져나와 보임). 차트를
              flex-1 min-h-0으로 감싸고 범례에 flex-wrap을 추가해서 실제로 필요한
              공간을 항상 확보하게 한다. */}
          <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
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
              <Tooltip {...chartTooltipProps(C)} />
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
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-dash-muted mt-2 shrink-0">
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
export function RealLevelDistributionChart({
  hours,
  module,
  kpiFilter = "ALL",
  chartType: chartTypeProp,
  onChartTypeChangeExternal,
}) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const { pollMs } = usePollInterval();
  const [internalType, setInternalType] = usePersistedPreference("sentinel-ops:chart-type:log-levels", defaultChartTypeFor("level-distribution"), ["bar", "donut"]);
  const isControlled = chartTypeProp !== undefined;
  const chartType = isControlled ? chartTypeProp : internalType;
  const sevParams = KPI_SEVERITY_PARAMS[kpiFilter] || {};
  const { levels, total, status, error } = useLogLevels({ hours, module, pollMs, ...sevParams });

  const data = REAL_SEVERITY_LEVELS.map((l, i) => {
    const found = levels.find((x) => x.severity === l.severity);
    return { key: l.key, label: l.label, count: found ? found.count : 0, color: donutPalette(theme)[i % DONUT_PALETTE.length] };
  });
  const [activeIndex, setPaused, focusIndex, blurIndex, highlighting] = useAutoCycleIndex(
    chartType === "donut" ? data.length : 0
  );
  // highlighting(hover 중이거나 mouseleave 후 1초 유예 안)일 때만 나머지 조각을
  // 회색으로 죽인다 - 자동 순환 스포트라이트 자체는 색을 안 죽인다.
  const targetFills = useMemo(
    () => data.map((d, i) => (!highlighting || i === activeIndex ? d.color : C.donutDim)),
    [data, highlighting, activeIndex, C.donutDim]
  );
  const animatedFills = useAnimatedFills(targetFills);
  const growth = useGrowPulse(activeIndex);

  return (
    <Card
      title="Log Levels"
      icon={SlidersHorizontal}
      subtitle={
        status === "ready"
          ? `선택 구간 · ${total}건${kpiFilter !== "ALL" ? ` · ${{ ERROR: "Errors", WARNING: "Warnings" }[kpiFilter] || kpiFilter} 필터` : ""}`
          : "불러오는 중..."
      }
      action={
        (!isControlled || onChartTypeChangeExternal) && (
          <ChartTypeToggle
            options={chartTypeOptionsFor("level-distribution")}
            value={chartType}
            onChange={onChartTypeChangeExternal ?? setInternalType}
          />
        )
      }
      // 2026-07-19: isControlled일 때 flex-col + flex-1 min-h-0 조합으로 바꿨다 -
      // Card가 block 레이아웃이라(flex-col 아니었을 때) 도넛/막대 콘텐츠의
      // height:100%가 "타이틀 행 아래 남는 공간"이 아니라 Card content-box
      // 전체(패딩 제외 h-full)를 기준으로 계산돼서, 타이틀 행+ 그 아래 margin
      // 만큼 항상 아래로 넘쳤다(실측: h=12여도 h=11이어도 정확히 34px 초과 -
      // 늘어난 높이가 그대로 다시 초과분에 흡수될 뿐 안 줄어드는 게 단서였음).
      // flex-col로 바꾸면 타이틀 행은 자기 콘텐츠 높이만 쓰고, flex-1
      // min-h-0을 준 콘텐츠 영역이 "진짜 남는 공간"을 갖게 되어 그 안의
      // height:100%가 정확히 계산된다.
      className={isControlled ? "min-h-80 h-full flex flex-col" : "h-80"}
    >
      {status === "error" && <p className="text-dash-critical text-xs">{error}</p>}
      {status !== "error" && chartType === "donut" && (
        <div className={isControlled ? "flex items-center gap-4 flex-1 min-h-0" : "flex items-center gap-4"}>
          {isControlled ? (
            // 커스텀 대시보드(위젯 박스 리사이즈 가능)에서는 고정 132px이 아니라
            // ResponsiveContainer로 박스 크기에 맞춰 커지고 작아지게 한다(2026-07-17
            // 요청 - "박스 리사이즈해도 내부 도넛이 안 따라온다"). 기본(고정 레이아웃)
            // 모드는 계속 고정 132px 그대로 둬서 이전에 잡은 "ResponsiveContainer가
            // 불필요하다"는 콘솔 워닝도 그대로 안 남는다.
            //
            // 2026-07-19: ResponsiveContainer를 flex 행(위 143번째 줄)의 자식으로
            // width="100%"만 주면, 박스가 넓어질수록 이 컨테이너가 남는 가로
            // 공간을 전부 차지해버리고 그 안에서 도넛은 (기본적으로 cx/cy="50%")
            // 정중앙에 그려진다 - 결과적으로 도넛과 범례 사이에 빈 공간만 넓어지고
            // 도넛 자체는 계속 가운데로 밀려 보였다(기본 모드는 고정 132px라
            // 이 문제 자체가 없음). aspect-square + h-full로 감싸서 이 컨테이너의
            // 가로 폭을 세로 높이에 맞춰 정사각형으로 고정 - 도넛은 여전히 박스
            // 높이에 따라 커지고 작아지지만(리사이즈 대응 유지), 가로로는 자기
            // 크기만큼만 차지해서 범례 바로 옆(기본 모드와 같은 위치)에 붙는다.
            <div className="h-full aspect-square shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
                  <Pie
                    data={data}
                    dataKey="count"
                    nameKey="label"
                    innerRadius="49%"
                    outerRadius="79%"
                    startAngle={90}
                    endAngle={-270}
                    stroke="none"
                    isAnimationActive={false}
                    activeIndex={activeIndex}
                    activeShape={(shapeProps) => renderGlowActiveShape(shapeProps, growth)}
                    onMouseEnter={(_, i) => focusIndex(i)}
                    onMouseLeave={blurIndex}
                  >
                    {data.map((d, i) => (
                      <Cell key={d.key} fill={animatedFills[i]} stroke={theme === "light" ? "#FFFFFF" : C.surfaceAlt} strokeWidth={0.7} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <PieChart width={132} height={132} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
              <Pie
                data={data}
                dataKey="count"
                nameKey="label"
                innerRadius={32}
                outerRadius={52}
                startAngle={90}
                endAngle={-270}
                stroke="none"
                isAnimationActive={false}
                activeIndex={activeIndex}
                activeShape={(shapeProps) => renderGlowActiveShape(shapeProps, growth)}
                onMouseEnter={(_, i) => focusIndex(i)}
                onMouseLeave={blurIndex}
              >
                {data.map((d, i) => (
                  <Cell key={d.key} fill={animatedFills[i]} stroke={theme === "light" ? "#FFFFFF" : C.surfaceAlt} strokeWidth={0.7} />
                ))}
              </Pie>
            </PieChart>
          )}
          <div className="flex-1 text-sm">
            {data.map((d, i) => (
              <div
                key={d.key}
                onMouseEnter={() => focusIndex(i)}
                onMouseLeave={blurIndex}
                className={`flex items-center justify-between gap-2 rounded-md px-1 -mx-1 py-0.5 transition-colors duration-200 ease-in-out ${
                  i === activeIndex ? "bg-dash-surfaceAlt/60" : ""
                }`}
                style={theme === "dark" && i === activeIndex ? { backgroundColor: C.surfaceAlt } : undefined}
              >
                <span
                  className={`flex items-center gap-1.5 truncate transition-colors duration-200 ease-in-out ${
                    !highlighting
                      ? i === activeIndex
                        ? "text-dash-fg"
                        : "text-dash-muted"
                      : i === activeIndex
                      ? "text-dash-fg font-bold"
                      : ""
                  }`}
                  // text-dash-faint(전역 muted 텍스트 색, 여러 곳에서 재사용)로 죽이면
                  // 도넛 조각(C.donutDim)보다 밝아서 라벨/조각 색이 어긋났다 - 이 상태만
                  // 인라인으로 C.donutDim을 직접 써서 조각과 라벨이 항상 같은 회색이 되게 한다.
                  style={highlighting && i !== activeIndex ? { color: C.donutDim } : undefined}
                >
                  <span
                    className="w-2 h-2 rounded-full inline-block shrink-0 transition-colors duration-200 ease-in-out"
                    style={{ backgroundColor: highlighting && i !== activeIndex ? C.donutDim : d.color }}
                  />
                  {d.label}
                </span>
                <span className="text-dash-fg">{d.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {status !== "error" && chartType !== "donut" && (isControlled ? (
        <div className="flex-1 min-h-0">
          <LogLevelBarPanel data={data} C={C} height="100%" theme={theme} />
        </div>
      ) : (
        <LogLevelBarPanel data={data} C={C} height={220} theme={theme} />
      ))}
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
    <Card title="Log Levels" icon={SlidersHorizontal} subtitle={`선택 구간 · ${events.length}건`} className="h-80">
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
            content={<ChartHoverPanel theme={theme} />}
            allowEscapeViewBox={{ x: true, y: true }}
            reverseDirection={{ x: false, y: false }}
            offset={0}
            isAnimationActive={false}
            wrapperStyle={{ pointerEvents: "none" }}
            cursor={false}
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
      icon={Crosshair}
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

export function ErrorRateGauge({ events, title = "Error Rate", subtitle = "Emergency~Major 비중", unitLabel = "logs", fillHeight = false }) {
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
  // flex-1은 기본 모드의 flex-col 오른쪽 컬럼 안에서만 의미가 있다 - 커스텀
  // 대시보드에서는 이 위젯 혼자 WidgetFrame의 평범한(비-flex) div 안에 놓이므로
  // flex-1이 아무 부모도 못 찾아 자기 콘텐츠 높이(약 140px 게이지 + 헤더)에서
  // 멈추고, 그리드 셀의 나머지 높이는 빈 여백으로 남았다(2026-07-23 확인) -
  // fillHeight일 때는 h-full로 그리드 셀 실제 높이를 직접 채운다.
  return (
    <Card title={title} icon={Gauge} subtitle={subtitle} className={fillHeight ? "h-full flex flex-col" : "flex-1 flex flex-col"}>
      <div className="relative flex-1 flex items-center justify-center min-h-[140px]">
        <div className="relative w-full">
          <ResponsiveContainer width="100%" height={140}>
            <PieChart>
              <Pie
                data={data}
                startAngle={180}
                endAngle={0}
                // 기본 중앙값(50%)에서는 반지름 72px의 윗부분이 140px 차트 밖으로
                // 약간 나간다. 중심을 소폭 내리면 게이지 상단이 잘리지 않는다.
                cy="55%"
                innerRadius={50}
                outerRadius={66}
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

// 카테고리형 데이터({key,label,count,color}[])의 막대그래프 버전 - 탐지소스/
// 심각도/K8s네임스페이스 도넛 3개 + Log Levels 위젯이 사용자 모드에서 "막대"로
// 전환됐을 때 공통으로 쓴다(도넛+범례 쪽은 각 위젯이 기존 JSX를 그대로 씀 -
// 호버 자동순환(useAutoCycleIndex) 상태를 위젯마다 이미 들고 있어서 그쪽까지
// 억지로 공용화하면 오히려 코드가 더 꼬인다).

// 막대 hover 시 "카테고리 / count : 숫자" 한 줄만 보여주는 미니멀 툴팁
// (2026-07-17 요청) - 공용 HoverPanel(점+큰 그림자)은 지도/도넛엔 맞지만
// 여기선 더 가벼운 스타일을 원해서 별도로 둔다.
// 차트 왼쪽 절반에서 hover하면 툴팁을 더 왼쪽으로, 오른쪽 절반이면 더
// 오른쪽으로 밀어서 커서/막대를 안 가리게 한다(예전 SideAwareTooltip 로직 -
// 미니멀 툴팁으로 바꾸면서 빠졌던 걸 다시 붙임, 유지하기로 확정).
function MinimalBarTooltip({ active, payload, coordinate, viewBox }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0];
  const mid = viewBox ? viewBox.x + viewBox.width / 2 : 0;
  const offsetX = coordinate && coordinate.x < mid ? -40 : 40;
  return (
    <div
      className="rounded-md bg-white px-2.5 py-1.5 text-xs text-gray-800 shadow-sm whitespace-nowrap"
      style={{ transform: `translateX(${offsetX}px)` }}
    >
      {p.payload.label} / count : {Number(p.value).toLocaleString()}
    </div>
  );
}

function LayerAttackHoverPanel({ active, payload, coordinate, viewBox, theme }) {
  if (!active || !payload?.length || !coordinate) return null;

  // vertical BarChart의 coordinate.y는 선택한 막대 행의 중앙이다. 막대의 반높이를
  // 빼서 패널의 아래쪽을 해당 막대 윗선에 붙인다. 따라서 WAS → WAF처럼 아래 행으로
  // 커서를 옮기면 패널도 반드시 같은 방향으로 내려간다.
  const barHalfHeight = ((viewBox?.height || 0) / LAYER_ORDER.length) * 0.45;

  return (
    <RechartsHoverPanel
      active={active}
      payload={payload}
      theme={theme}
      labelFormatter={(_, entries) => entries?.[0]?.payload?.label}
      formatter={(value) => [`${value}건`, "적중 건수"]}
      transform={`translate(-50%, calc(-100% - ${8 + barHalfHeight}px))`}
    />
  );
}

function LogLevelHoverPanel({ active, payload, theme }) {
  if (!active || !payload?.length) return null;

  return (
    <RechartsHoverPanel
      active={active}
      payload={payload}
      theme={theme}
      labelFormatter={(_, entries) => entries?.[0]?.payload?.label}
      formatter={(value) => [`${value}건`, "로그 수"]}
      transform="translate(-50%, calc(-100% - 16px))"
    />
  );
}

// 2026-07-17(재작업): hover 시 나머지를 회색으로 죽이던 걸 없애고, 카테고리마다
// hover 여부와 무관하게 항상 자기 색(d.color)을 유지하도록 되돌렸다(참고 이미지
// 기준 - "hover된 막대만 강조색이고 나머지는 무채색"이던 걸 "전부 항상 고유
// 색상"으로). 대신 hover된 막대 뒤에 세로 컬럼 하이라이트(회색, Tooltip의
// cursor)와, Y축 그리드+파란 눈금, 플롯 배경을 추가해서 하이라이트 방식 자체를
// "막대 색 죽이기"에서 "배경에 컬럼 강조"로 바꿨다.
export function useBarHoverIndex() {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const resetTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(resetTimerRef.current), []);
  return [
    hoveredIndex,
    {
      onMouseMove: (state) => {
        clearTimeout(resetTimerRef.current);
        const rawIndex = state?.activeTooltipIndex;
        const index = rawIndex == null ? NaN : Number(rawIndex);
        setHoveredIndex(Number.isInteger(index) ? index : null);
      },
      // 차트 밖으로 나갈 때 즉시 원색으로 튀지 않게, 도넛의 hover 해제와
      // 같은 짧은 유예를 둔다. 각 Cell의 fill transition과 함께 자연스럽게 복귀한다.
      onMouseLeave: () => {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = setTimeout(() => setHoveredIndex(null), 120);
      },
    },
  ];
}

function CategoryBarChart({ data, C, height = 160, theme }) {
  const tickBlue = donutPalette(theme)[3];
  const [hoveredIndex, hoverHandlers] = useBarHoverIndex();
  // CSS transition만으로는 Recharts가 SVG fill 속성을 교체하는 타이밍에 따라
  // 모션이 생략될 수 있다. 도넛과 같은 색상 보간 훅으로 실제 전환 프레임을 만든다.
  const animatedFills = useAnimatedFills(
    useMemo(() => data.map((d, i) => (hoveredIndex !== null && i !== hoveredIndex ? C.donutDim : d.color)), [data, hoveredIndex, C.donutDim]),
    220
  );

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ bottom: 8 }} {...hoverHandlers}>
        <CartesianGrid stroke={C.surfaceAlt} vertical={false} />
        <XAxis dataKey="label" stroke={C.muted} tickLine={false} axisLine={false} fontSize={10} interval={0} />
        <YAxis stroke={tickBlue} tick={{ fill: tickBlue }} tickLine={false} axisLine={false} fontSize={11} />
        <Tooltip
          content={<ChartHoverPanel theme={theme} />}
          allowEscapeViewBox={{ x: true, y: true }}
          reverseDirection={{ x: false, y: false }}
          offset={0}
          isAnimationActive={false}
          wrapperStyle={{ pointerEvents: "none" }}
          cursor={{ fill: theme === "dark" ? C.surfaceAlt : C.muted, opacity: theme === "dark" ? 1 : 0.15 }}
        />
        <Bar dataKey="count" radius={[6, 6, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={d.key} fill={animatedFills[i]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function LogLevelBarPanel({ data, C, height = 160, theme }) {
  const tickBlue = donutPalette(theme)[3];
  const [hoveredIndex, hoverHandlers] = useBarHoverIndex();
  const animatedFills = useAnimatedFills(
    useMemo(() => data.map((d, i) => (hoveredIndex !== null && i !== hoveredIndex ? C.donutDim : d.color)), [data, hoveredIndex, C.donutDim]),
    220
  );

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ bottom: 8 }} {...hoverHandlers}>
        <CartesianGrid stroke={C.surfaceAlt} vertical={false} />
        <XAxis dataKey="label" stroke={C.muted} tickLine={false} axisLine={false} fontSize={10} interval={0} />
        <YAxis stroke={tickBlue} tick={{ fill: tickBlue }} tickLine={false} axisLine={false} fontSize={11} />
        <Tooltip
          content={<LogLevelHoverPanel theme={theme} />}
          allowEscapeViewBox={{ x: true, y: true }}
          reverseDirection={{ x: false, y: false }}
          offset={0}
          isAnimationActive={false}
          wrapperStyle={{ pointerEvents: "none" }}
          cursor={{ fill: theme === "dark" ? C.surfaceAlt : C.muted, opacity: theme === "dark" ? 1 : 0.15 }}
        />
        <Bar dataKey="count" radius={[6, 6, 0, 0]} isAnimationActive={false}>
          {data.map((d, i) => <Cell key={d.key} fill={animatedFills[i]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// 지구본의 자동 회전처럼, 도넛 차트도 가만히 있지 않고 조각을 하나씩 순회하며
// 스포트라이트를 비춰준다 — 사용자가 호버하면 그 순간엔 자동 순환을 멈춘다.
// focus(i): 옆 정보 패널의 항목에 마우스를 올렸을 때 그 조각으로 즉시 점프 + 정지.
// blur(): 정보 패널에서 마우스가 떠나도 바로 재개하지 않고 대기했다가, 그때
// 멈춰있던 조각(index)부터 이어서 자동 순환을 재개한다 - 처음(0)으로 리셋하지
// 않도록 setPaused(false)만 호출하고 index는 건드리지 않는다.
//
// 2026-07-17(재정리): 확대(activeIndex/enlarge)와 색상 회색화(예전엔 별도
// hoveredIndex state)가 서로 다른 지연시간(10초 vs 즉시)으로 따로 놀아서
// 두 애니메이션 타이밍이 어긋난다는 피드백 - highlighting 플래그를 여기서
// 같이 관리해서 "hover로 강조 중인가"를 하나의 상태/하나의 타이머로 통일한다.
// focus()에서 true, blur()의 지연(resumeDelayMs, 이제 1초)이 끝날 때 false로
// 같이 떨어지므로, 호출부는 highlighting && i !== activeIndex로 색상/확대를
// 항상 같은 순간에 켜고 끌 수 있다. 자동 순환 스포트라이트 자체(hover 없을 때
// activeIndex가 계속 도는 것)는 이 변경과 무관하게 그대로 유지됨.
export function useAutoCycleIndex(length, intervalMs = 2200, resumeDelayMs = 1000) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [highlighting, setHighlighting] = useState(false);
  const resumeTimer = useRef(null);
  useEffect(() => {
    if (!length) return;
    if (index >= length) setIndex(0);
  }, [length]);
  useEffect(() => {
    if (!length || paused) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % length), intervalMs);
    return () => clearInterval(t);
  }, [length, paused, intervalMs]);
  useEffect(() => () => clearTimeout(resumeTimer.current), []);
  const focus = (i) => {
    clearTimeout(resumeTimer.current);
    setIndex(i);
    setPaused(true);
    setHighlighting(true);
  };
  const blur = () => {
    clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => {
      // 2026-07-17 요청: "회색이 컬러로 돌아오는 시점"과 "스포트라이트가 다음
      // 조각으로 넘어가는 시점"을 동시에 맞춰달라 - paused=false만 하면 자동
      // 순환 setInterval이 그때부터 새로 intervalMs(2.2초)를 기다렸다가에서야
      // 다음 조각으로 넘어가서, 색은 여기서 바로 복귀하는데 스포트라이트는
      // 한참 뒤에야 움직이는 어긋남이 있었다. 여기서 인덱스를 직접 한 칸
      // 넘겨서 "회색→컬러 복귀"와 "다음 조각으로 이동"이 정확히 같은 순간에
      // 일어나게 한다.
      if (length) setIndex((i) => (i + 1) % length);
      setPaused(false);
      setHighlighting(false);
    }, resumeDelayMs);
  };
  return [index, setPaused, focus, blur, highlighting];
}

function hexOrRgbToRgb(input) {
  if (input.startsWith("rgb")) {
    const [r, g, b] = input.match(/\d+/g).map(Number);
    return { r, g, b };
  }
  const n = parseInt(input.replace("#", ""), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function lerpColor(from, to, t) {
  const a = hexOrRgbToRgb(from);
  const b = hexOrRgbToRgb(to);
  return `rgb(${Math.round(a.r + (b.r - a.r) * t)}, ${Math.round(a.g + (b.g - a.g) * t)}, ${Math.round(a.b + (b.b - a.b) * t)})`;
}

function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function easeOutQuad(t) {
  return 1 - (1 - t) ** 2;
}

// 도넛 조각 hover 시 회색화를 CSS transition으로 구현했더니 순간적으로 바뀌는
// 문제가 있었다(2026-07-17 피드백) - Playwright로 getComputedStyle(sector).fill을
// 프레임 단위로 실측해보니, recharts Pie가 isAnimationActive일 때 hover로 인한
// 리렌더마다 <path>(.recharts-sector)를 새 DOM 노드로 다시 그려서(react-smooth
// Animate 래퍼 재실행) "이전 색"이 없어 CSS transition이 보간할 대상 자체가
// 없었음 - DOM identity가 아예 유실되는 걸 확인함(마커 프로퍼티가 hover 직후
// 사라짐). 그래서 recharts/CSS에 맡기지 않고, 매 프레임 색을 JS로 직접
// 보간해서 fill에 완성된 rgb() 문자열로 꽂아준다 - 매 프레임 DOM이 새로
// 만들어지더라도 그 순간의 올바른 색이 바로 찍히므로 애니메이션처럼 보인다.
//
// 2026-07-17(추가): hover 진입은 부드러운데 해제는 순간적으로 바뀌는 비대칭
// 현상이 있었다 - 원인은 이 fill 애니메이션 자체가 아니라, Pie에 남아있던
// isAnimationActive(700ms)가 activeIndex/activeShape가 바뀌는 hover 진입
// 시점에만 추가로 겹쳐 걸리면서(회전목마 스포트라이트가 옮겨붙는 순간) 두
// 애니메이션이 섞여 "진입만 유독 오래/부드럽게" 보이게 만들었던 것 - 해제 때는
// activeIndex가 안 바뀌니(useAutoCycleIndex의 blur는 인덱스를 유지) 이 fill
// 트윈만 단독으로 돌아서 상대적으로 더 빨라 보였다. Pie 쪽 isAnimationActive를
// 꺼서(각 Pie의 activeShape/activeIndex 자체는 그대로 유지 - 확대 로직 불변)
// 이 fill 트윈만 색상 전환을 전담하게 해서 양방향이 대칭적으로 느껴지도록
// 했다(범례 텍스트/배경박스/점의 CSS transition도 전부 동일한 duration으로
// 맞춰서 조각과 어긋나지 않게 함).
//
// 2026-07-17(속도 조정 + 확대 동기화): "색 전환이 느리다"는 피드백으로
// 200ms로 단축 - 동시에 조각 확대 애니메이션(useGrowPulse, renderGlowActiveShape)도
// 같은 200ms를 쓰게 해서 "커지는 모션"과 "색 변화"가 정확히 같은 순간에
// 시작하고 끝난다(둘 다 activeIndex/highlighting이 바뀌는 같은 이벤트에서
// 트리거되므로, duration만 맞추면 동기화됨).
export function useAnimatedFills(targetColors, durationMs = 200) {
  const [colors, setColors] = useState(targetColors);
  const colorsRef = useRef(targetColors);
  const prevTargetsRef = useRef(targetColors);
  const rafRef = useRef(null);

  useEffect(() => {
    const prevTargets = prevTargetsRef.current;
    const changed =
      targetColors.length !== prevTargets.length || targetColors.some((c, i) => c !== prevTargets[i]);
    prevTargetsRef.current = targetColors;
    if (!changed) return undefined;

    const from = colorsRef.current;
    const start = performance.now();
    cancelAnimationFrame(rafRef.current);

    const tick = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = easeInOutQuad(t);
      const next = targetColors.map((c, i) => lerpColor(from[i] ?? c, c, eased));
      colorsRef.current = next;
      setColors(next);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetColors.join("|"), durationMs]);

  return colors;
}

// activeIndex가 바뀔 때마다(hover로 옮겨가거나 자동 순환이 다음 조각으로
// 넘어갈 때) 0→1로 다시 출발하는 진행률 - renderGlowActiveShape가 이 값으로
// 확대 폭(+5/+7~+10)을 0부터 서서히 키워서 "즉각 커짐" 대신 부드러운 pop
// 효과를 낸다(2026-07-17 요청, 0.2~0.3s ease-out). useAnimatedFills와 같은
// RAF 방식 - recharts의 isAnimationActive는 이미 hover 시 DOM을 새로 그려서
// 못 쓰는 걸 앞서 확인했으므로(위 useAnimatedFills 주석 참고) 여기서도 같은
// 이유로 자체 구현한다.
export function useGrowPulse(trigger, durationMs = 200) {
  const [progress, setProgress] = useState(1);
  const rafRef = useRef(null);
  useEffect(() => {
    const start = performance.now();
    cancelAnimationFrame(rafRef.current);
    setProgress(0);
    const tick = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      setProgress(t);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, durationMs]);
  return progress;
}

// 활성 조각을 살짝 키우고 바깥에 얇은 발광 링을 둘러서 "스포트라이트가 훑고
// 지나간다"는 느낌을 준다. outerRadius+10까지 부풀리므로, 이걸 쓰는 Pie를 담은
// ResponsiveContainer는 반드시 (outerRadius+10)*2보다 여유 있게 잡아야 한다 -
// 안 그러면 SVG 뷰포트 경계에서 강조된 조각 끝이 잘린다(2026-07-16 실측 버그,
// outerRadius=52인 도넛 4개가 110×110 컨테이너에 담겨있어서 62 > 55(절반)로
// 잘렸었음 - 132×132로 키워서 고침).
// growth(0~1, useGrowPulse)만큼 확대 폭 자체를 스케일해서 "커지는 중"인
// 애니메이션을 표현한다 - 기본값 1은 growth를 안 넘기는 다른 호출부 대비용.
// 2026-07-17 버그 수정 - "도넛에 마우스 대고 움직이면 가끔 멈춘다"의 원인.
// 이 함수는 activeIndex(확대 중인 조각)를 recharts가 기본 <Sector> 대신
// 그릴 때 쓰는 렌더러다. props에서 cx/cy/... 도형 값만 꺼내 쓰고
// onMouseEnter/onMouseLeave는 안 넘겨줬더니, 어떤 조각이 활성화(확대)되는
// 순간 그 조각의 실제 DOM이 이벤트 핸들러가 아예 없는 이 도형으로 바뀌어서 -
// 마우스가 그 위에 있는 동안 더 이상 leave 이벤트가 안 잡히고(핸들러 자체가
// 없으니까) blurIndex()가 영영 안 불려서 hover가 그 조각에 낀 채 멈췄다.
// props에 원래 들어있는 핸들러를 <g>에 그대로 물려줘서 고친다.
export function renderGlowActiveShape(props, growth = 1) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, onMouseEnter, onMouseLeave } = props;
  const eased = easeOutQuad(growth);
  return (
    <g onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius + 5 * eased}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
      />
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={outerRadius + 7 * eased}
        outerRadius={outerRadius + 10 * eased}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        opacity={0.35 * eased}
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

// 2026-07-16(8차)에 "별로였다"는 피드백으로 기본 Overview 화면에서 제거했던
// "실시간 활동 흐름" 위젯 - 2026-07-18, "어제 추가했다가 삭제한 실시간 탐지하는
// 것도 위젯 목록에 추가해달라"는 요청으로 복원. 단, 기본 화면에는 다시 넣지
// 않고 위젯 설정(커스텀 대시보드) 팔레트에서 원하는 사람만 추가하는 선택적
// 위젯으로만 등록한다(catalog type: "activity-flow", WIDGET_CATALOG 참고) -
// 기본 모드 자체는 그대로 안 건드리는 게 이 구조의 원칙(DashboardBuilder 위
// 주석 참고).
const ACTIVITY_MODULE_ORDER = ["waf", "was", "k8s_audit", "falco"];

// WAS/WAF/Falco/K8s Audit 건물 비유(출입문 보안검색대 -> 내부 CCTV -> 관리실
// 통제기록 -> 방 안 정밀수색)를 땅속 4개 지층으로 그린다. 계층 순서/깊이는
// ACTIVITY_MODULE_ORDER와 동일하게 맞춘다.
const LAYER_INFO = {
  waf: { depth: "1단계", caption: "출입문 · 보안 검색대", desc: "요청이 앱에 닿기 전에 먼저 걸러내는 곳" },
  was: { depth: "2단계", caption: "건물 내부 · CCTV", desc: "앱까지 들어온 요청이 실제로 찍히는 곳" },
  k8s_audit: { depth: "3단계", caption: "관리실 · 통제 기록", desc: "클러스터 설정을 누가 바꿨는지 남는 곳" },
  falco: { depth: "4단계", caption: "방 안 · 정밀 수색", desc: "컨테이너 안에서 실제로 실행된 동작을 보는 곳" },
};

// 최근 1분 이내(WINDOW_MS) 이벤트만 점으로 남기고, 그 창을 벗어나면 점도 같이
// 사라진다 - 조용하면 계층이 비어있고, 로그가 들어오면 그때부터 점이 하나씩 늘어난다.
const ACTIVITY_WINDOW_MS = 60_000;

const ACTIVITY_GROUND_Y = 30;
const ACTIVITY_LAYER_H = 64;
const ACTIVITY_LAYER_GAP = 8;
const ACTIVITY_DIAGRAM_HEIGHT =
  ACTIVITY_GROUND_Y + ACTIVITY_MODULE_ORDER.length * (ACTIVITY_LAYER_H + ACTIVITY_LAYER_GAP) - ACTIVITY_LAYER_GAP + 10;

// "이 로그가 어느 계층 로그인지"만 확실한 사실 기준으로 묶는다 - event.module
// 4종 고정 분류라 왜곡 없이 보여줄 수 있다. useLiveAttackFeed(LiveTicker와 같은
// 폴링, /events/recent 기반)를 재사용.
export function LiveActivityTree() {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const { feed } = useLiveAttackFeed({ feedLimit: 80 });
  // 새 이벤트가 안 들어와도 시간은 계속 흐르므로(1분이 지나면 점이 빠져야 함),
  // 2초마다 강제로 리렌더해서 "지금으로부터 1분 이내" 기준을 다시 계산한다.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, []);

  // "로그 하나당 점 하나가 깜빡이며 나타난다"는 걸 표현하기 위해, 이전
  // 렌더에서 이미 본 이벤트 키를 기억해뒀다가 이번 렌더에 처음 보이는
  // 이벤트만 _isNew로 표시한다.
  const seenKeysRef = useRef(new Set());

  const layers = useMemo(() => {
    const cutoff = Date.now() - ACTIVITY_WINDOW_MS;
    const seen = seenKeysRef.current;
    return ACTIVITY_MODULE_ORDER.map((module) => {
      const events = feed
        .filter((e) => e.module === module && e.timestamp.getTime() >= cutoff)
        .sort((a, b) => b.timestamp - a.timestamp);
      const maxSeverity = events.reduce((m, e) => Math.max(m, e.severity || 0), 0);
      const recent = events.slice(0, 10).map((e) => {
        const key = `${module}-${e.timestamp.getTime()}-${e.sourceIp || e.pod || e.namespace || ""}`;
        return { ...e, _key: key, _isNew: !seen.has(key) };
      });
      return {
        module,
        meta: getModuleMeta(module),
        count: events.length,
        maxSeverity,
        recent,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed, tick]);

  // 렌더 커밋 후 이번에 보인 키들을 "이미 본 것"으로 표시 - 다음 렌더부터는
  // 같은 이벤트가 다시 새것으로 판정되어 반짝이지 않는다.
  useEffect(() => {
    const seen = seenKeysRef.current;
    layers.forEach((layer) => layer.recent.forEach((e) => seen.add(e._key)));
    if (seen.size > 500) {
      const keep = new Set(layers.flatMap((layer) => layer.recent.map((e) => e._key)));
      seenKeysRef.current = keep;
    }
  }, [layers]);

  return (
    <Card
      title="실시간 탐지"
      subtitle="WAF → WAS → K8s Audit → Falco, 건물 비유의 4단계 지하 구조 — 최근 1분 이내 로그만 점으로 표시"
    >
      <div className="overflow-x-auto">
        <ActivityLayerDiagram layers={layers} C={C} />
      </div>
    </Card>
  );
}

// 각 계층은 가로로 긴 띠 하나 - 왼쪽엔 "몇 단계 / 무슨 로그 / 건물 비유 캡션",
// 오른쪽엔 그 계층에서 실제로 찍힌 최근 이벤트를 점으로 나열한다(가장 왼쪽이
// 최신). 위험 이벤트(severity>=REAL_ERROR_MIN_SEVERITY)만 activity-ripple-ring으로
// 펄스를 준다.
function ActivityLayerDiagram({ layers, C }) {
  const width = 560;
  const groundY = ACTIVITY_GROUND_Y;
  const LAYER_H = ACTIVITY_LAYER_H;
  const LAYER_GAP = ACTIVITY_LAYER_GAP;
  const LABEL_W = 128;
  const DOT_R = 6;
  const DOT_GAP = 20;
  const DOTS_X0 = LABEL_W + 22;
  const MAX_DOTS = Math.min(10, Math.floor((width - DOTS_X0 - 14) / DOT_GAP));
  const height = ACTIVITY_DIAGRAM_HEIGHT;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="실시간 활동 흐름 - 계층별 지하 구조">
      <line x1={0} y1={groundY} x2={width} y2={groundY} stroke={C.faint} strokeWidth={1} strokeDasharray="3 4" />
      <text x={0} y={groundY - 9} fontSize={9} fill={C.faint}>
        지표면
      </text>
      <circle cx={width - 40} cy={groundY - 12} r={4} fill={C.live} className="animate-pulse" />
      <text x={width - 30} y={groundY - 9} fontSize={9} fill={C.muted}>
        LIVE
      </text>

      {layers.map((layer, i) => {
        const y0 = groundY + i * (LAYER_H + LAYER_GAP);
        const info = LAYER_INFO[layer.module];
        const dotsY = y0 + LAYER_H / 2 + 4;
        const recent = layer.recent.slice(0, MAX_DOTS);
        const depthOpacity = 0.06 + i * 0.035;

        return (
          <g key={layer.module}>
            <rect x={0} y={y0} width={width} height={LAYER_H} fill={layer.meta.color} opacity={depthOpacity} />
            <rect x={0} y={y0} width={width} height={LAYER_H} fill="none" stroke={C.surfaceAlt} strokeWidth={1} />

            <text x={10} y={y0 + 17} fontSize={8.5} fontWeight={700} fill={C.faint} letterSpacing={0.5}>
              {info.depth}
            </text>
            <text x={10} y={y0 + 31} fontSize={11} fontWeight={700} fill={layer.meta.color}>
              {layer.meta.label}
            </text>
            <text x={10} y={y0 + 44} fontSize={8} fill={C.muted}>
              {info.caption}
            </text>
            <text x={10} y={y0 + LAYER_H - 7} fontSize={8} fill={C.faint}>
              {layer.count}건
            </text>

            <line x1={LABEL_W} y1={y0 + 6} x2={LABEL_W} y2={y0 + LAYER_H - 6} stroke={C.surfaceAlt} strokeWidth={1} />

            {recent.length === 0 ? (
              <text x={DOTS_X0} y={dotsY - 4} fontSize={9} fill={C.faint}>
                최근 1분간 활동 없음
              </text>
            ) : (
              recent.map((e, j) => {
                const ex = DOTS_X0 + j * DOT_GAP;
                const eSevMeta = getRealSeverityMeta(e.severity);
                const eDanger = (e.severity || 0) >= REAL_ERROR_MIN_SEVERITY;
                const isNewest = j === 0;
                return (
                  <g key={e._key || `${layer.module}-${e.timestamp}-${j}`}>
                    {eDanger && (
                      <circle
                        cx={ex}
                        cy={dotsY - 4}
                        r={DOT_R + 2}
                        fill="none"
                        stroke={eSevMeta.color}
                        strokeWidth={1.5}
                        className="activity-ripple-ring"
                      />
                    )}
                    <circle
                      cx={ex}
                      cy={dotsY - 4}
                      r={isNewest ? DOT_R + 1 : DOT_R}
                      fill={eDanger ? eSevMeta.color : layer.meta.color}
                      opacity={isNewest ? 1 : Math.max(0.25, 0.85 - j * 0.07)}
                      stroke={C.bg}
                      strokeWidth={1}
                      className={e._isNew ? "activity-dot-blink" : undefined}
                    >
                      <title>{`${e.sourceIp || e.pod || e.namespace || "-"} · ${eSevMeta.label}`}</title>
                    </circle>
                  </g>
                );
              })
            )}
          </g>
        );
      })}
    </svg>
  );
}

// 탐지 소스별(WAS/Falco/K8s Audit) 도넛 — 3계층 상관분석 프로젝트의 핵심 축이라
// Overview 요약에도 반드시 있어야 하는 지표. GET /stats(by_module) 연동 - WAF는
// 비활성화 상태라 보통 안 잡히거나 0건(정상).
function DetectionSourceDonutCompact({ lookbackMs, kpiFilter = "ALL", chartType: chartTypeProp, onChartTypeChangeExternal }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const [internalType, setInternalType] = usePersistedPreference("sentinel-ops:chart-type:detection-source", defaultChartTypeFor("donut-source"), ["donut", "bar"]);
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
          return { key: d.module, count: d.count, label: meta.label, color: donutPalette(theme)[i % DONUT_PALETTE.length] };
        }),
    [byModule, theme]
  );
  const total = data.reduce((s, d) => s + d.count, 0);
  const [activeIndex, setPaused, focusIndex, blurIndex, highlighting] = useAutoCycleIndex(
    chartType === "donut" ? data.length : 0
  );
  // highlighting(hover 중이거나 mouseleave 후 1초 유예 안)일 때만 나머지 조각을
  // 회색으로 죽인다 - 자동 순환 스포트라이트 자체는 색을 안 죽인다.
  const targetFills = useMemo(
    () => data.map((d, i) => (!highlighting || i === activeIndex ? d.color : C.donutDim)),
    [data, highlighting, activeIndex, C.donutDim]
  );
  const animatedFills = useAnimatedFills(targetFills);
  const growth = useGrowPulse(activeIndex);

  return (
    <Card
      title="탐지 소스별 분포"
      icon={Layers}
      subtitle={
        status === "ready"
          ? `WAS / Falco / K8s Audit · 총 ${total}건${kpiFilter !== "ALL" ? ` · ${{ ERROR: "Errors", WARNING: "Warnings" }[kpiFilter] || kpiFilter} 필터` : ""}`
          : "불러오는 중..."
      }
      action={
        (!isControlled || onChartTypeChangeExternal) && (
          <ChartTypeToggle
            options={chartTypeOptionsFor("donut-source")}
            value={chartType}
            onChange={onChartTypeChangeExternal ?? setInternalType}
          />
        )
      }
      // 2026-07-19: isControlled일 때 flex-col + flex-1 min-h-0 조합 - Card가
      // block 레이아웃이면 도넛/막대 콘텐츠의 height:100%가 "타이틀 행 아래
      // 남는 공간"이 아니라 Card content-box 전체를 기준으로 계산돼서 타이틀
      // 행+margin만큼 항상 아래로 넘친다(막대 모드는 도넛 모드보다 이 문제가
      // 덜 티나지만 구조는 동일 - level-distribution의 Log Levels에서 실측
      // 확인: h를 늘려도 초과분이 정확히 그대로 34px 고정이었음, 즉 늘어난
      // 높이가 그대로 다시 초과분에 흡수될 뿐이었다는 게 단서). flex-col +
      // flex-1 min-h-0으로 "진짜 남는 공간"을 명시적으로 만들어야 그 안의
      // height:100%가 정확히 계산된다.
      className={isControlled ? "h-full flex flex-col" : ""}
    >
      {status === "error" && <p className="text-dash-critical text-xs">{error}</p>}
      {status === "ready" && data.length === 0 && <p className="text-dash-muted text-xs">이 구간에는 로그가 없습니다.</p>}
      {data.length > 0 && chartType === "bar" && (isControlled ? (
        <div className="flex-1 min-h-0">
          <CategoryBarChart data={data} C={C} height="100%" theme={theme} />
        </div>
      ) : (
        <CategoryBarChart data={data} C={C} height={150} theme={theme} />
      ))}
      {data.length > 0 && chartType === "donut" && (
        <div className={isControlled ? "flex items-center gap-4 flex-1 min-h-0" : "flex items-center gap-4"}>
          {isControlled ? (
            // 커스텀 대시보드(위젯 박스 리사이즈 가능)에서는 고정 132px이 아니라
            // ResponsiveContainer로 박스 크기에 맞춰 커지고 작아지게 한다(2026-07-17
            // 요청 - "박스 리사이즈해도 내부 도넛이 안 따라온다"). 기본(고정 레이아웃)
            // 모드는 계속 고정 132px 그대로 둬서 이전에 잡은 "ResponsiveContainer가
            // 불필요하다"는 콘솔 워닝도 그대로 안 남는다. WidgetFrame은 이 위젯
            // 내부를 그대로(overflow-auto로만) 감싸므로 이 컴포넌트가 직접
            // 박스 크기에 반응해야 한다.
            //
            // 2026-07-19: aspect-square + h-full로 감싸서 가로 폭을 세로 높이에
            // 맞춘다 - 안 그러면 이 컨테이너가 flex 행의 남는 가로 공간을 전부
            // 차지해서 도넛이 정중앙으로 밀리고 범례와 멀어져 보였다(기본 모드는
            // 고정 132px라 이 문제가 없음). 자세한 설명은 RealLevelDistributionChart
            // 쪽 같은 주석 참고.
            <div className="h-full aspect-square shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
                  <Pie
                    data={data}
                    dataKey="count"
                    nameKey="label"
                    innerRadius="49%"
                    outerRadius="79%"
                    startAngle={90}
                    endAngle={-270}
                    stroke="none"
                    isAnimationActive={false}
                    activeIndex={activeIndex}
                    activeShape={(shapeProps) => renderGlowActiveShape(shapeProps, growth)}
                    onMouseEnter={(_, i) => focusIndex(i)}
                    onMouseLeave={blurIndex}
                  >
                    {data.map((d, i) => (
                      <Cell key={d.key} fill={animatedFills[i]} stroke={theme === "light" ? "#FFFFFF" : C.surfaceAlt} strokeWidth={0.7} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <PieChart width={132} height={132} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
              <Pie
                data={data}
                dataKey="count"
                nameKey="label"
                innerRadius={32}
                outerRadius={52}
                startAngle={90}
                endAngle={-270}
                stroke="none"
                isAnimationActive={false}
                activeIndex={activeIndex}
                activeShape={(shapeProps) => renderGlowActiveShape(shapeProps, growth)}
                onMouseEnter={(_, i) => focusIndex(i)}
                onMouseLeave={blurIndex}
              >
                {data.map((d, i) => (
                  <Cell key={d.key} fill={animatedFills[i]} stroke={theme === "light" ? "#FFFFFF" : C.surfaceAlt} strokeWidth={0.7} />
                ))}
              </Pie>
            </PieChart>
          )}
          <div className="flex-1 text-sm">
            {data.map((d, i) => (
              <div
                key={d.key}
                onMouseEnter={() => focusIndex(i)}
                onMouseLeave={blurIndex}
                className={`flex items-center justify-between gap-2 rounded-md px-1 -mx-1 py-0.5 transition-colors duration-200 ease-in-out ${
                  i === activeIndex ? "bg-dash-surfaceAlt/60" : ""
                }`}
                style={theme === "dark" && i === activeIndex ? { backgroundColor: C.surfaceAlt } : undefined}
              >
                <span
                  className={`flex items-center gap-1.5 truncate transition-colors duration-200 ease-in-out ${
                    !highlighting
                      ? i === activeIndex
                        ? "text-dash-fg"
                        : "text-dash-muted"
                      : i === activeIndex
                      ? "text-dash-fg font-bold"
                      : ""
                  }`}
                  // text-dash-faint(전역 muted 텍스트 색, 여러 곳에서 재사용)로 죽이면
                  // 도넛 조각(C.donutDim)보다 밝아서 라벨/조각 색이 어긋났다 - 이 상태만
                  // 인라인으로 C.donutDim을 직접 써서 조각과 라벨이 항상 같은 회색이 되게 한다.
                  style={highlighting && i !== activeIndex ? { color: C.donutDim } : undefined}
                >
                  <span
                    className="w-2 h-2 rounded-full inline-block shrink-0 transition-colors duration-200 ease-in-out"
                    style={{ backgroundColor: highlighting && i !== activeIndex ? C.donutDim : d.color }}
                  />
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
function SeverityDonutCompact({ hours, chartType: chartTypeProp, onChartTypeChangeExternal }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const { pollMs } = usePollInterval();
  const [internalType, setInternalType] = usePersistedPreference("sentinel-ops:chart-type:overview-severity", defaultChartTypeFor("donut-severity"), ["donut", "bar"]);
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
        .map((d, i) => ({ ...d, color: donutPalette(theme)[i % DONUT_PALETTE.length] })),
    [levels, theme]
  );
  const [activeIndex, setPaused, focusIndex, blurIndex, highlighting] = useAutoCycleIndex(
    chartType === "donut" ? data.length : 0
  );
  // highlighting(hover 중이거나 mouseleave 후 1초 유예 안)일 때만 나머지 조각을
  // 회색으로 죽인다 - 자동 순환 스포트라이트 자체는 색을 안 죽인다.
  const targetFills = useMemo(
    () => data.map((d, i) => (!highlighting || i === activeIndex ? d.color : C.donutDim)),
    [data, highlighting, activeIndex, C.donutDim]
  );
  const animatedFills = useAnimatedFills(targetFills);
  const growth = useGrowPulse(activeIndex);

  return (
    <Card
      title="심각도 분포"
      icon={AlertTriangle}
      subtitle={status === "ready" ? `선택 구간 · 총 ${total}건` : "불러오는 중..."}
      action={
        (!isControlled || onChartTypeChangeExternal) && (
          <ChartTypeToggle
            options={chartTypeOptionsFor("donut-severity")}
            value={chartType}
            onChange={onChartTypeChangeExternal ?? setInternalType}
          />
        )
      }
      // 2026-07-19: isControlled일 때 flex-col + flex-1 min-h-0 조합 - Card가
      // block 레이아웃이면 도넛/막대 콘텐츠의 height:100%가 "타이틀 행 아래
      // 남는 공간"이 아니라 Card content-box 전체를 기준으로 계산돼서 타이틀
      // 행+margin만큼 항상 아래로 넘친다(막대 모드는 도넛 모드보다 이 문제가
      // 덜 티나지만 구조는 동일 - level-distribution의 Log Levels에서 실측
      // 확인: h를 늘려도 초과분이 정확히 그대로 34px 고정이었음, 즉 늘어난
      // 높이가 그대로 다시 초과분에 흡수될 뿐이었다는 게 단서). flex-col +
      // flex-1 min-h-0으로 "진짜 남는 공간"을 명시적으로 만들어야 그 안의
      // height:100%가 정확히 계산된다.
      className={isControlled ? "h-full flex flex-col" : ""}
    >
      {status === "error" && <p className="text-dash-critical text-xs">{error}</p>}
      {status === "ready" && data.length === 0 && <p className="text-dash-muted text-xs">이 구간에는 로그가 없습니다.</p>}
      {data.length > 0 && chartType === "bar" && (isControlled ? (
        <div className="flex-1 min-h-0">
          <CategoryBarChart data={data} C={C} height="100%" theme={theme} />
        </div>
      ) : (
        <CategoryBarChart data={data} C={C} height={150} theme={theme} />
      ))}
      {data.length > 0 && chartType === "donut" && (
        <div className={isControlled ? "flex items-center gap-4 flex-1 min-h-0" : "flex items-center gap-4"}>
          {isControlled ? (
            // 커스텀 대시보드(위젯 박스 리사이즈 가능)에서는 고정 132px이 아니라
            // ResponsiveContainer로 박스 크기에 맞춰 커지고 작아지게 한다(2026-07-17
            // 요청 - "박스 리사이즈해도 내부 도넛이 안 따라온다"). 기본(고정 레이아웃)
            // 모드는 계속 고정 132px 그대로 둬서 이전에 잡은 "ResponsiveContainer가
            // 불필요하다"는 콘솔 워닝도 그대로 안 남는다. WidgetFrame은 이 위젯
            // 내부를 그대로(overflow-auto로만) 감싸므로 이 컴포넌트가 직접
            // 박스 크기에 반응해야 한다.
            //
            // 2026-07-19: aspect-square + h-full로 감싸서 가로 폭을 세로 높이에
            // 맞춘다 - 안 그러면 이 컨테이너가 flex 행의 남는 가로 공간을 전부
            // 차지해서 도넛이 정중앙으로 밀리고 범례와 멀어져 보였다(기본 모드는
            // 고정 132px라 이 문제가 없음). 자세한 설명은 RealLevelDistributionChart
            // 쪽 같은 주석 참고.
            <div className="h-full aspect-square shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
                  <Pie
                    data={data}
                    dataKey="count"
                    nameKey="label"
                    innerRadius="49%"
                    outerRadius="79%"
                    startAngle={90}
                    endAngle={-270}
                    stroke="none"
                    isAnimationActive={false}
                    activeIndex={activeIndex}
                    activeShape={(shapeProps) => renderGlowActiveShape(shapeProps, growth)}
                    onMouseEnter={(_, i) => focusIndex(i)}
                    onMouseLeave={blurIndex}
                  >
                    {data.map((d, i) => (
                      <Cell key={d.key} fill={animatedFills[i]} stroke={theme === "light" ? "#FFFFFF" : C.surfaceAlt} strokeWidth={0.7} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <PieChart width={132} height={132} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
              <Pie
                data={data}
                dataKey="count"
                nameKey="label"
                innerRadius={32}
                outerRadius={52}
                startAngle={90}
                endAngle={-270}
                stroke="none"
                isAnimationActive={false}
                activeIndex={activeIndex}
                activeShape={(shapeProps) => renderGlowActiveShape(shapeProps, growth)}
                onMouseEnter={(_, i) => focusIndex(i)}
                onMouseLeave={blurIndex}
              >
                {data.map((d, i) => (
                  <Cell key={d.key} fill={animatedFills[i]} stroke={theme === "light" ? "#FFFFFF" : C.surfaceAlt} strokeWidth={0.7} />
                ))}
              </Pie>
            </PieChart>
          )}
          <div className="flex-1 text-sm">
            {data.map((d, i) => (
              <div
                key={d.key}
                onMouseEnter={() => focusIndex(i)}
                onMouseLeave={blurIndex}
                className={`flex items-center justify-between gap-2 rounded-md px-1 -mx-1 py-0.5 transition-colors duration-200 ease-in-out ${
                  i === activeIndex ? "bg-dash-surfaceAlt/60" : ""
                }`}
                style={theme === "dark" && i === activeIndex ? { backgroundColor: C.surfaceAlt } : undefined}
              >
                <span
                  className={`flex items-center gap-1.5 truncate transition-colors duration-200 ease-in-out ${
                    !highlighting
                      ? i === activeIndex
                        ? "text-dash-fg"
                        : "text-dash-muted"
                      : i === activeIndex
                      ? "text-dash-fg font-bold"
                      : ""
                  }`}
                  // text-dash-faint(전역 muted 텍스트 색, 여러 곳에서 재사용)로 죽이면
                  // 도넛 조각(C.donutDim)보다 밝아서 라벨/조각 색이 어긋났다 - 이 상태만
                  // 인라인으로 C.donutDim을 직접 써서 조각과 라벨이 항상 같은 회색이 되게 한다.
                  style={highlighting && i !== activeIndex ? { color: C.donutDim } : undefined}
                >
                  <span
                    className="w-2 h-2 rounded-full inline-block shrink-0 transition-colors duration-200 ease-in-out"
                    style={{ backgroundColor: highlighting && i !== activeIndex ? C.donutDim : d.color }}
                  />
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
// 계층(WAS/WAF/Falco/K8s Audit) 4개의 적중 합계만 보여준다. 2026-07-17: "K8s
// 네임스페이스별 분포는 필요 없다, 계층별 공격 통계로 바꿔달라" 피드백으로 이
// 카드가 있던 자리(위젯 타입은 donut-k8s-namespace 그대로 유지 - 저장된 커스텀
// 대시보드가 이 슬롯을 참조 중일 수 있어 타입 키를 바꾸면 그 대시보드에서만
// 위젯이 사라진다)를 교체했다. 처음엔 시나리오(공격) 단위 랭킹 막대까지 같이
// 보여줬는데, "네 가지 계층만 보여주고 세부적으로 나타내지 말아달라"는 후속
// 피드백(2026-07-17)으로 개별 시나리오 목록은 걷어내고 계층 4개 요약만 남겼다.
// required_modules[0](YAML에서 시나리오가 요구하는 첫 모듈)을 그 시나리오의
// "계층"으로 취급한다.
//
// scenarios/status/error는 props로 받는다(자체 useScenarios() 호출 안 함) - 같은
// /scenarios 응답을 "탐지 시나리오" KPI 카드(kpi-sources)도 필요로 해서, 부모
// (DashboardContent)가 한 번만 fetch해 두 위젯에 같이 내려준다.
const LAYER_ORDER = ["was", "waf", "falco", "k8s_audit"];

function LayerAttackStatsCompact({ scenarios, status, error, controlled = false, chartType: chartTypeProp, onChartTypeChangeExternal }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const [internalType, setInternalType] = usePersistedPreference("sentinel-ops:chart-type:layer-attacks", "bar", ["bar", "donut"]);
  const isControlled = chartTypeProp !== undefined;
  const chartType = isControlled ? chartTypeProp : internalType;

  const layerTotals = useMemo(() => {
    const byModule = {};
    scenarios.forEach((s) => {
      const module = s.required_modules?.[0] || "unknown";
      byModule[module] = (byModule[module] || 0) + (s.hit_count || 0);
    });
    return LAYER_ORDER.map((m) => {
      const meta = getModuleMeta(m);
      // 라이트에서는 모듈 고유색을 그대로 보이고, 네온 대비가 강한 다크에서만
      // 심각도 도넛과 같은 정도로 한 단계 톤을 낮춘다.
      const color = theme === "dark" ? forTheme(meta.color, "light") : meta.color;
      return { module: m, ...meta, color, count: byModule[m] || 0 };
    });
  }, [scenarios, theme]);
  const totalHits = layerTotals.reduce((sum, l) => sum + l.count, 0);
  const [activeIndex, setPaused, focusIndex, blurIndex, highlighting] = useAutoCycleIndex(
    chartType === "donut" ? layerTotals.length : 0
  );
  const targetFills = useMemo(
    () => layerTotals.map((l, i) => (!highlighting || i === activeIndex ? l.color : C.donutDim)),
    [layerTotals, highlighting, activeIndex, C.donutDim]
  );
  const animatedFills = useAnimatedFills(targetFills);
  const growth = useGrowPulse(activeIndex);
  const [hoveredBarIndex, barHoverHandlers] = useBarHoverIndex();
  const animatedBarFills = useAnimatedFills(
    useMemo(
      () => layerTotals.map((l, i) => (hoveredBarIndex !== null && i !== hoveredBarIndex ? C.donutDim : l.color)),
      [layerTotals, hoveredBarIndex, C.donutDim]
    ),
    220
  );

  return (
    <Card
      title="계층별 공격 통계"
      icon={Layers}
      subtitle={status === "ready" ? `전체 기간 · 총 ${totalHits}건` : "불러오는 중..."}
      action={
        (!isControlled || onChartTypeChangeExternal) && (
          <ChartTypeToggle
            options={chartTypeOptionsFor("donut-k8s-namespace")}
            value={chartType}
            onChange={onChartTypeChangeExternal ?? setInternalType}
          />
        )
      }
      className={controlled ? "h-full flex flex-col" : ""}
    >
      {status === "error" && <p className="text-dash-critical text-xs">{error}</p>}
      {status === "ready" && chartType === "bar" && (
        <div className={controlled ? "flex-1 min-h-0" : ""}>
          <ResponsiveContainer width="100%" height={controlled ? "100%" : 150}>
            <BarChart data={layerTotals} layout="vertical" margin={{ left: 4, right: 24, top: 4, bottom: 4 }} {...barHoverHandlers}>
              <CartesianGrid stroke={C.surfaceAlt} horizontal={false} />
              <XAxis type="number" stroke={C.muted} tickLine={false} axisLine={false} fontSize={10} allowDecimals={false} />
              <YAxis type="category" dataKey="label" stroke={C.muted} tickLine={false} axisLine={false} fontSize={11} width={80} />
              <Tooltip
                content={<LayerAttackHoverPanel theme={theme} />}
                allowEscapeViewBox={{ x: true, y: true }}
                reverseDirection={{ x: false, y: false }}
                offset={0}
                isAnimationActive={false}
                wrapperStyle={{ pointerEvents: "none" }}
                cursor={{ fill: C.surfaceAlt, opacity: theme === "dark" ? 1 : 0.5 }}
              />
              <Bar dataKey="count" radius={[0, 6, 6, 0]} isAnimationActive={false}>
                {layerTotals.map((l, i) => (
                  <Cell key={l.module} fill={animatedBarFills[i]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {status === "ready" && chartType === "donut" && (
        <div className={controlled ? "flex items-center gap-4 flex-1 min-h-0" : "flex items-center gap-4"}>
          {controlled ? (
            <div className="h-full aspect-square shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
                  <Pie
                    data={layerTotals}
                    dataKey="count"
                    nameKey="label"
                    innerRadius="49%"
                    outerRadius="79%"
                    startAngle={90}
                    endAngle={-270}
                    stroke="none"
                    isAnimationActive={false}
                    activeIndex={activeIndex}
                    activeShape={(shapeProps) => renderGlowActiveShape(shapeProps, growth)}
                    onMouseEnter={(_, i) => focusIndex(i)}
                    onMouseLeave={blurIndex}
                  >
                    {layerTotals.map((l, i) => (
                      <Cell key={l.module} fill={animatedFills[i]} stroke={theme === "light" ? "#FFFFFF" : C.surfaceAlt} strokeWidth={0.7} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <PieChart width={132} height={132} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
              <Pie
                data={layerTotals}
                dataKey="count"
                nameKey="label"
                innerRadius={32}
                outerRadius={52}
                startAngle={90}
                endAngle={-270}
                stroke="none"
                isAnimationActive={false}
                activeIndex={activeIndex}
                activeShape={(shapeProps) => renderGlowActiveShape(shapeProps, growth)}
                onMouseEnter={(_, i) => focusIndex(i)}
                onMouseLeave={blurIndex}
              >
                {layerTotals.map((l, i) => (
                  <Cell key={l.module} fill={animatedFills[i]} stroke={theme === "light" ? "#FFFFFF" : C.surfaceAlt} strokeWidth={0.7} />
                ))}
              </Pie>
            </PieChart>
          )}
          <div className="flex-1 text-sm">
            {layerTotals.map((l, i) => (
              <div
                key={l.module}
                onMouseEnter={() => focusIndex(i)}
                onMouseLeave={blurIndex}
                className={`flex items-center justify-between gap-2 rounded-md px-1 -mx-1 py-0.5 transition-colors duration-200 ease-in-out ${
                  i === activeIndex ? "bg-dash-surfaceAlt/60" : ""
                }`}
                style={theme === "dark" && i === activeIndex ? { backgroundColor: C.surfaceAlt } : undefined}
              >
                <span
                  className={`flex items-center gap-1.5 truncate transition-colors duration-200 ease-in-out ${
                    !highlighting
                      ? i === activeIndex
                        ? "text-dash-fg"
                        : "text-dash-muted"
                      : i === activeIndex
                      ? "text-dash-fg font-bold"
                      : ""
                  }`}
                  style={highlighting && i !== activeIndex ? { color: C.donutDim } : undefined}
                >
                  <span
                    className="w-2 h-2 rounded-full inline-block shrink-0 transition-colors duration-200 ease-in-out"
                    style={{ backgroundColor: highlighting && i !== activeIndex ? C.donutDim : l.color }}
                  />
                  {l.label}
                </span>
                <span className="text-dash-fg">{l.count}</span>
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
// countries는 도시 단위 포인트라(2026-07-16, GeoLite2-City 도입) 같은 나라가 여러
// 개 있을 수 있다 - 부제의 "N개국"은 countries.length가 아니라 countryCode
// distinct count로 센다.
function GeoSummaryCard({ fillHeight = false }) {
  const { theme } = useTheme();
  const { countries, status, error } = useGeoStats({ limit: 50 });
  const total = countries.reduce((s, c) => s + c.count, 0);
  const countryCount = new Set(countries.map((c) => c.countryCode)).size;
  // 2026-07-17(7차): "Infrastructure처럼 Overview 지도도 2D/3D 토글로 바꿀 수
  // 있게 해달라" - Infrastructure 패널과 같은 2D(Google Maps)/3D(지구본) 전환을
  // 여기도 그대로 적용. 기본은 지금까지 써왔던 3D(지구본)를 유지해서 랜딩 화면의
  // "화려한" 첫인상은 그대로 두고, 자세히 보고 싶을 때만 2D로 바꾸게 했다.
  const [mapMode, setMapMode] = usePersistedPreference("sentinel-ops:map-mode:overview-geo", "2d", ["2d", "3d"]);

  return (
    <Card
      title="공격 발원지 (GeoIP)"
      icon={MapPin}
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
      // 2026-07-19 요청: 카드와 지도 둘 다 아래로 넓혀달라 - h-[360px] 고정이던
      // 지도 영역을 flex-1로 바꿔서 카드 자체가 커진 만큼 지도도 그대로 따라
      // 커지게 했다(전에 도넛 위젯에서 겪은 것과 같은 이유로 Card를 flex-col +
      // 내부를 flex-1 min-h-0으로 - block 레이아웃이면 height:100%가 카드
      // 전체 기준으로 계산돼서 타이틀 행만큼 넘친다).
      // 2026-07-23: h-[560px] 자체가 커스텀 대시보드의 geo-summary 그리드 셀
      // 실측 높이(h:17 -> 596px)보다 작게 고정돼 있었고, 위젯을 리사이즈로
      // 더 키워도 지도가 전혀 안 따라와 빈 여백만 커졌다 - fillHeight일 때는
      // h-full로 그리드 셀 실제 높이를 그대로 채운다.
      className={fillHeight ? "min-h-[560px] h-full flex flex-col" : "h-[560px] flex flex-col"}
    >
      {status === "error" && <p className="text-dash-critical text-xs mb-2">{error}</p>}
      <div className="flex-1 min-h-0">
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
    <Card title="API Latency" icon={Gauge} subtitle={stats ? "요청이 처리되기까지 걸린 시간이에요 (숫자가 작을수록 빠른 거예요)" : "데이터 없음"}>
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
      icon={ScrollText}
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

// 위젯 설정 팔레트용 미니 미리보기 아이콘 - 2026-07-18, "글씨 라벨만 있어서
// 어떤 위젯인지 안 보인다"는 피드백으로 추가. 실제 데이터를 fetch하는 진짜
// 차트를 팔레트에 그대로 그리면 목록 하나 열 때마다 API가 N번 나가서 무겁고,
// chartTypeOptions가 있는 위젯은 어차피 사용자가 나중에 바꿀 수 있으니 "종류"만
// 대표하는 간단한 도형으로 충분하다고 판단했다. WIDGET_CATALOG의 icon 필드
// (kind)로 어떤 모양을 그릴지 정한다.
function WidgetPreviewIcon({ kind }) {
  const stroke = "rgb(var(--dash-mint))";
  const dim = "currentColor";
  const cls = "w-9 h-6 shrink-0 text-dash-faint";
  switch (kind) {
    case "number":
      return (
        <svg viewBox="0 0 36 24" className={cls}>
          <rect x="1" y="1" width="34" height="22" rx="4" fill="none" stroke={dim} strokeOpacity="0.35" />
          <text x="18" y="16" textAnchor="middle" fontSize="10" fill={stroke} fontWeight="700">88</text>
        </svg>
      );
    case "area":
      return (
        <svg viewBox="0 0 36 24" className={cls}>
          <polyline points="2,18 9,10 16,14 23,6 30,11 34,4" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "bar":
      return (
        <svg viewBox="0 0 36 24" className={cls}>
          {[6, 14, 20, 10, 17].map((h, i) => (
            <rect key={i} x={2 + i * 7} y={22 - h} width="4" height={h} fill={stroke} opacity="0.85" />
          ))}
        </svg>
      );
    case "hbar":
      return (
        <svg viewBox="0 0 36 24" className={cls}>
          {[26, 18, 12, 8].map((w, i) => (
            <rect key={i} x="2" y={2 + i * 5} width={w} height="3" rx="1.5" fill={stroke} opacity="0.85" />
          ))}
        </svg>
      );
    case "donut":
      return (
        <svg viewBox="0 0 36 24" className={cls}>
          <circle cx="18" cy="12" r="9" fill="none" stroke={dim} strokeOpacity="0.2" strokeWidth="4" />
          <circle cx="18" cy="12" r="9" fill="none" stroke={stroke} strokeWidth="4" strokeDasharray="34 57" strokeLinecap="round" transform="rotate(-90 18 12)" />
        </svg>
      );
    case "list":
      return (
        <svg viewBox="0 0 36 24" className={cls}>
          {[4, 10, 16].map((y, i) => (
            <rect key={i} x="2" y={y} width={i === 0 ? 30 : i === 1 ? 24 : 28} height="3" rx="1.5" fill={stroke} opacity={0.8 - i * 0.15} />
          ))}
        </svg>
      );
    case "gauge":
      return (
        <svg viewBox="0 0 36 24" className={cls}>
          <path d="M4 20 A14 14 0 0 1 32 20" fill="none" stroke={dim} strokeOpacity="0.2" strokeWidth="4" />
          <path d="M4 20 A14 14 0 0 1 22 7" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
        </svg>
      );
    case "map":
      return (
        <svg viewBox="0 0 36 24" className={cls}>
          <rect x="1" y="1" width="34" height="22" rx="4" fill="none" stroke={dim} strokeOpacity="0.2" />
          <circle cx="12" cy="10" r="2" fill={stroke} />
          <circle cx="22" cy="15" r="3" fill={stroke} opacity="0.6" />
          <circle cx="27" cy="7" r="1.5" fill={stroke} />
        </svg>
      );
    case "pulse":
      return (
        <svg viewBox="0 0 36 24" className={cls}>
          <circle cx="18" cy="12" r="3" fill={stroke} />
          <circle cx="18" cy="12" r="7" fill="none" stroke={stroke} strokeOpacity="0.5" strokeWidth="1.5" />
          <circle cx="18" cy="12" r="11" fill="none" stroke={stroke} strokeOpacity="0.25" strokeWidth="1.5" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 36 24" className={cls}>
          <rect x="1" y="1" width="34" height="22" rx="4" fill="none" stroke={dim} strokeOpacity="0.25" />
        </svg>
      );
  }
}

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
// height/onHeightChange: 2026-07-18, "도넛 차트들 길이가 버그가 있던데 위젯
// 높이도 설정할 수 있게 해달라"는 피드백으로 추가 - -/+ 버튼으로 grid row
// 단위(h)를 직접 조절한다.
//
// 2026-07-18: 박스 크기와 콘텐츠를 transform:scale로 동기화하는
// useAutoFitBox를 여기 얹었었는데(리사이즈 시 박스와 콘텐츠 크기가
// 어긋나는 버그를 고치려던 시도), baseline 측정 자체가 react-grid-layout의
// 폭 계산과 경쟁 상태(race condition)에 걸려 처음부터 잘못된 기준선을
// 캡처하는 별도 버그가 발견됐다(리사이즈를 전혀 안 해도 콘텐츠가 박스를
// 못 채움, 실측 확인) - 그 버그를 더 파고들기보다 팀원 버전(overflow로
// 그냥 넘치면 스크롤)으로 되돌린다. 도넛류 위젯의 isControlled 동적
// ResponsiveContainer 크기 조절(다른 함수들 참고)은 이 훅과 무관한 별도
// 메커니즘이라 그대로 유지.
function WidgetFrame({ widgetType, title, chartType, onChartTypeChange, onRemove, height, onHeightChange, children }) {
  const options = chartTypeOptionsFor(widgetType);

  return (
    <div className="group relative h-full w-full">
      {/* 2026-07-19: overflow-auto -> overflow-clip - WIDGET_CATALOG의 minW/minH를
          실측으로 다시 맞춰서 이제 정상 사용 중엔 스크롤이 필요할 일이 없어야
          한다. 그래도 혹시 측정이 어긋나는 경우(새 위젯 추가, 데이터에 따라
          텍스트 길이가 달라지는 경우 등)에 스크롤바가 노출되는 대신 조용히
          잘리게 하는 안전장치일 뿐 - 이게 필요해지는 상황 자체가 생기면 그건
          이 안전장치가 아니라 minW/minH 실측값을 다시 고쳐야 한다는 신호다.
          내부에 자체 스크롤 영역(예: Recent Logs 테이블 본문)이 있는 위젯은
          그 안쪽 요소가 따로 overflow-y-auto를 갖고 있어 여기서 clip으로
          바꿔도 영향 없다. */}
      <div className="h-full w-full overflow-clip">{children}</div>
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
        {onHeightChange && (
          <div
            className="flex items-center gap-0.5 shrink-0 normal-case tracking-normal cursor-default border-l border-dash-surfaceAlt pl-1.5 ml-0.5"
            onMouseDown={(e) => e.stopPropagation()}
            title="위젯 높이 조절"
          >
            <button
              onClick={() => onHeightChange(-2)}
              title="낮게"
              className="w-4 h-4 flex items-center justify-center rounded text-dash-muted hover:text-dash-fg hover:bg-dash-surfaceAlt leading-none"
            >
              −
            </button>
            <span className="text-dash-faint tabular-nums w-4 text-center">{height}</span>
            <button
              onClick={() => onHeightChange(2)}
              title="높게"
              className="w-4 h-4 flex items-center justify-center rounded text-dash-muted hover:text-dash-fg hover:bg-dash-surfaceAlt leading-none"
            >
              +
            </button>
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
  // 2026-07-19 요청: 캔버스 높이가 드래그/리사이즈 중엔 안 따라오고 손을 뗀
  // 순간(onLayoutChange, widgets 상태 커밋 시점)에만 갱신돼서 한 박자 늦게
  // 느껴진다는 피드백 - onDrag/onResize(react-grid-layout이 마우스를 움직일
  // 때마다 계속 쏘는 콜백, widgets 상태를 커밋하는 onDragStop/onLayoutChange와
  // 별개)로 "지금 드래그/리사이즈 중인 위치"를 바로바로 반영해서 캔버스가
  // 실시간으로 따라오게 한다. 손을 떼면(Stop) widgets 상태 자체가 그 값을
  // 반영하므로 0으로 리셋 - 안 그러면 다른 위젯을 짧게 만들었을 때 예전 드래그
  // 위치가 유령처럼 남아 캔버스가 안 줄어든다.
  const [liveBottomRow, setLiveBottomRow] = useState(0);
  const handleLiveDrag = (_layout, _oldItem, newItem) => setLiveBottomRow(newItem.y + newItem.h);
  const handleLiveDragStop = () => setLiveBottomRow(0);
  const canvasRef = useRef(null);

  // 2026-07-19~22: 팔레트에서 캔버스로 "드래그해서" 놓는 방식(HTML5 네이티브
  // 드래그 + RGL의 isDroppable/droppingItem 브릿지)을 여러 각도로 고쳐봤다 -
  // 겹친 위젯을 CSS로 미리 밀어 보여주는 프리뷰를 얹었다가 RGL 자체 호버 처리와
  // 이중으로 겹쳐 "2칸 밀림" 버그가 났고(제거함), 그 프리뷰를 없애도 실제
  // 드롭 위치 자체가 RGL 내부 상태 갱신 타이밍과 어긋나 "항상 한 칸 뒤로
  // 밀려서 놓이는" 문제가 남았다(react-grid-layout 소스까지 확인 - handleDrop이
  // 읽는 위치가 내부 layoutRef에 최신 dragover 위치가 반영되는 시점과 어긋남).
  // 이 타이밍 문제를 근본적으로 없애려면 라이브러리의 훅 기반 API(useGridLayout)
  // 로 갈아타야 하는데 대시보드 빌더 렌더링을 통째로 다시 짜야 할 만큼 큰
  // 작업이라, 대신 "드래그해서 놓기" 자체를 없애고 "클릭하면 캔버스 맨 아래에
  // 바로 추가"로 바꿨다 - 위치를 조정하고 싶으면 이미 안정적으로 동작이
  // 확인된 기존 위젯 드래그(아래 draggableHandle, handleLiveDrag/onDragStop)로
  // 옮기면 된다. 외부 드래그 브릿지(isDroppable/droppingItem/onDrop) 자체가
  // 필요 없어졌다.
  const handleAddWidget = (type) => {
    const entry = catalogEntry(type);
    if (!entry) return;
    setWidgets((prev) => {
      const bottomRow = prev.length === 0 ? 0 : Math.max(...prev.map((w) => w.y + w.h));
      return [
        ...prev,
        {
          uid: makeWidgetUid(),
          type,
          x: 0,
          y: bottomRow,
          w: entry.w,
          h: entry.h,
          chartType: defaultChartTypeFor(type),
        },
      ];
    });
  };

  const handleLayoutChange = (newLayout) => {
    setWidgets((prev) => applyLayoutToWidgets(prev, newLayout));
  };

  const removeWidget = (uid) => setWidgets((prev) => prev.filter((w) => w.uid !== uid));
  const setWidgetChartType = (uid, type) =>
    setWidgets((prev) => prev.map((w) => (w.uid === uid ? { ...w, chartType: type } : w)));
  // 2026-07-18: "위젯들 높이도 설정할 수 있게 해달라" 피드백 - 리사이즈 핸들
  // 드래그 대신 -/+ 버튼으로 grid row(h) 단위를 직접 조절. 최소 3(너무 작으면
  // 헤더도 못 담아 의미 없음)으로 바닥을 둔다.
  const setWidgetHeight = (uid, delta) =>
    setWidgets((prev) => prev.map((w) => (w.uid === uid ? { ...w, h: Math.max(3, w.h + delta) } : w)));

  const gridLayout = widgets.map((w) => {
    const entry = catalogEntry(w.type);
    return { i: w.uid, x: w.x, y: w.y, w: w.w, h: w.h, minW: entry?.minW, minH: entry?.minH };
  });
  // 2026-07-19 요청: 캔버스 여유 공간을 화면 배수(예: 1.2배) 같은 고정값이
  // 아니라, 실제로 배치된 위젯이 아래로 내려가면 그만큼 캔버스도 늘어나고
  // 위로 올리면 다시 줄어드는 식으로 - 가장 아래에 있는 위젯의 y+h(그리드 행
  // 기준, liveBottomRow가 있으면 그것도 같이 고려 - 드래그/리사이즈 도중
  // 실시간 반영용)를 실제 px로 환산(rowHeight=20, margin=16 - 아래
  // ResponsiveGridLayout prop과 반드시 맞출 것)한 뒤, 계속 이어서 쌓을 수
  // 있을 만큼(DROP_BUFFER_PX, 위젯 한두 개 분량) 여유를 더한다. autoSize
  // (react-grid-layout 기본값)가 이미 콘텐츠 높이만큼 컨테이너를 줄이므로,
  // 여기서는 "그 자연 높이 + 드롭 여유분"만 바닥값으로 얹어주면 된다.
  const DROP_BUFFER_PX = 480;
  const committedBottomRow = widgets.length === 0 ? 0 : Math.max(...widgets.map((w) => w.y + w.h));
  const gridBottomRow = Math.max(committedBottomRow, liveBottomRow);
  const gridContentHeightPx = gridBottomRow * 20 + Math.max(0, gridBottomRow - 1) * 16;
  const canvasMinHeight = gridContentHeightPx + DROP_BUFFER_PX;
  const canSave = widgets.length > 0 && name.trim().length > 0;
  // 2026-07-18: "중복 제거해서 사용한 위젯은 안 나오게" 피드백 - 캔버스에 이미
  // 올라간 타입은 팔레트에서 숨긴다(이전엔 같은 타입을 여러 번 놓을 수 있게
  // 일부러 허용했었는데, 그게 오히려 "지금 뭘 더 추가할 수 있는지" 헷갈리게
  // 만든다는 피드백으로 방침을 바꿨다). 이미 추가한 위젯을 빼고 싶으면
  // WidgetFrame의 ✕로 캔버스에서 지우면 팔레트에 다시 나타난다.
  const usedTypes = new Set(widgets.map((w) => w.type));
  const availableCatalog = WIDGET_CATALOG.filter((w) => !usedTypes.has(w.type));

  return (
    <div className="flex flex-col lg:flex-row gap-4 items-start">
      <div className="w-full lg:w-56 shrink-0 bg-dash-surface rounded-2xl border border-dash-mint/15 p-3 space-y-1.5">
        <p className="text-dash-faint text-[11px] uppercase tracking-wide mb-1">위젯 목록 (클릭해서 캔버스 맨 아래에 추가)</p>
        {availableCatalog.length === 0 && (
          <p className="text-dash-faint text-[11px] px-1 py-2">모든 위젯을 이미 추가했습니다.</p>
        )}
        {availableCatalog.map((w) => (
          <button
            key={w.type}
            type="button"
            onClick={() => handleAddWidget(w.type)}
            className="w-full cursor-pointer flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-dash-surfaceAlt/70 text-dash-fg hover:bg-dash-mint/15 hover:text-dash-mint transition-colors select-none text-left"
          >
            <WidgetPreviewIcon kind={w.icon} />
            <span className="truncate">{w.label}</span>
          </button>
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

        <div className="relative" ref={canvasRef}>
          {widgets.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-dash-faint text-xs pointer-events-none border border-dashed border-dash-mint/25 rounded-2xl px-6 text-center">
              왼쪽 목록에서 위젯을 클릭해서 추가하세요.
            </div>
          )}
          <ResponsiveGridLayout
            className="layout"
            layout={gridLayout}
            onLayoutChange={handleLayoutChange}
            onDrag={handleLiveDrag}
            onDragStop={handleLiveDragStop}
            onResize={handleLiveDrag}
            onResizeStop={handleLiveDragStop}
            cols={12}
            rowHeight={20}
            margin={[16, 16]}
            draggableHandle=".widget-drag-handle"
            // compactType="vertical"(팀원 버전으로 되돌림, 2026-07-18) - 위젯을
            // 지우거나 옮기면 그 아래 위젯들이 자동으로 위 빈자리를 채운다.
            // null로 자유 배치를 시도했었는데("위치 그대로 유지") 지운 자리가
            // 안 채워져서 오히려 더 불편하다는 피드백으로 되돌림.
            compactType="vertical"
            // 2026-07-19 요청: 위젯이 화면 절반쯤 채워지면 그 아래로 새 위젯을
            // 놓을 여유 공간이 안 보여서(react-grid-layout의 autoSize가 기본값
            // true라 컨테이너가 콘텐츠 높이에 딱 맞게 줄어듦) 어디에 드롭해야
            // 할지 헷갈린다는 피드백 - 처음엔 화면 높이의 1.2~1.5배 같은 고정
            // 배수를 항상 깔아뒀는데, "위젯을 옮길 때마다 그에 맞춰 캔버스가
            // 늘고 줄어야 한다"는 후속 피드백으로 방향을 바꿨다. 이제
            // canvasMinHeight(위 gridBottomRow 기반, 가장 아래 위젯 바로 밑에
            // DROP_BUFFER_PX만큼만 여유)를 바닥값으로 써서, 위젯을 아래로
            // 옮기면 그만큼 캔버스가 커지고 위로 올리면 다시 줄어든다.
            style={{ minHeight: widgets.length === 0 ? 220 : canvasMinHeight }}
          >
            {widgets.map((w) => (
              <div key={w.uid}>
                <WidgetFrame
                  widgetType={w.type}
                  title={catalogEntry(w.type)?.label}
                  chartType={w.chartType}
                  onChartTypeChange={(type) => setWidgetChartType(w.uid, type)}
                  height={w.h}
                  onHeightChange={(delta) => setWidgetHeight(w.uid, delta)}
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

// 저장해둔 커스텀 대시보드를 "적용해서 보기"만 하는 뷰 - 레이아웃을 짜는
// DashboardBuilder(편집 캔버스)와는 다른 상태다. 처음 만들 때는 이 둘을 구분
// 안 하고 편집 캔버스와 완전히 같은 방식(자유 드래그/리사이즈 + KPI 카드 클릭
// 무효화 + hover 오버레이)으로 렌더링했는데, 몇 차례 피드백을 거쳐 최종적으로:
//   - 레이아웃(위치/크기)은 기본 모드처럼 고정 - isDraggable/isResizable=false.
//     바꾸려면 "위젯 편집"으로 DashboardBuilder를 열어야 한다.
//   - KPI 카드는 기본 모드와 동일하게 클릭되는 필터 버튼 - renderWidgetContent에
//     interactive=true를 넘겨서 onClick/active(kpiFilter)를 받는다.
//   - WidgetFrame(hover하면 우상단에 뜨는 드래그핸들/제거 버튼 오버레이)은 아예
//     안 쓴다 - "커스텀 세팅(편집 캔버스)할 때만 떠야 하는 게 적용된 화면에서도
//     뜬다"는 피드백으로 제거.
//   - 차트 종류 전환(도넛↔막대 등)은 WidgetFrame 오버레이가 없어지면서 같이
//     사라졌던 걸 복구 - 기본 모드 위젯처럼 각 차트 자체의 Card 헤더에 항상
//     보이는 토글로 다시 붙였다(handleChartType, renderWidgetContent의 4번째
//     인자로 각 차트 컴포넌트까지 흘려보냄 - 각 컴포넌트의 onChartTypeChangeExternal
//     prop 참고).
// 으로 정리됐다.
function CustomDashboardView({ dashboard, renderWidgetContent, onChartTypeCommit }) {
  const gridLayout = dashboard.widgets.map((w) => {
    const entry = catalogEntry(w.type);
    return { i: w.uid, x: w.x, y: w.y, w: w.w, h: w.h, minW: entry?.minW, minH: entry?.minH };
  });

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
          isDraggable={false}
          isResizable={false}
          cols={12}
          rowHeight={20}
          margin={[16, 16]}
          compactType="vertical"
        >
          {dashboard.widgets.map((w) => (
            <div key={w.uid}>
              {/* WidgetFrame을 안 쓴다 - hover하면 우상단에 드래그 핸들/제거 버튼이
                  뜨는 편집용 오버레이라, 드래그·리사이즈·제거를 이미 다 막아놨어도
                  hover 패널 자체는 계속 나타나서 "편집 캔버스에서만 떠야 하는 게
                  적용된 화면에서도 뜬다"는 피드백을 받았다. overflow-clip 안전장치
                  (WidgetFrame 쪽 주석 참고)만 유지한 얇은 wrapper로 대체. 차트
                  타입 전환은 이 오버레이가 아니라 각 차트 자체의 Card 헤더 토글로
                  옮겨 살아있다(위 handleChartType, onChartTypeChangeExternal). */}
              <div className="h-full w-full overflow-clip">
                {renderWidgetContent(w.type, w.chartType, true, (type) => handleChartType(w.uid, type))}
              </div>
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
  const [rangeKey, setRangeKey] = usePersistedOverviewLogRange();
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
  // 2026-07-19 버그 수정 - "커스텀 대시보드로 이동하면 편집 패널이 뜬다": 편집
  // 캔버스(DashboardBuilder)를 연 채로(저장/취소 안 하고) 상단 "위젯 설정"
  // 드롭다운에서 다른 항목(기본 모드 포함)을 고르면, activeId는 바뀌는데
  // builderOpen은 그대로 true라 DashboardBuilder가 계속 떠 있었다(헤더 라벨만
  // "기본 모드"로 바뀌고 화면은 여전히 위젯 팔레트/저장 버튼이 있는 편집 캔버스).
  // WidgetSettingsMenu에 원본 setActiveId를 그대로 안 넘기고, 드롭다운에서
  // 뭘 고르든(기본 모드/다른 커스텀 대시보드) 항상 builderOpen부터 닫는 래퍼를
  // 넘긴다 - 그래야 항상 기본 모드처럼 깔끔한 뷰(CustomDashboardView 또는
  // 고정 JSX)로 이동한다.
  function selectDashboardFromMenu(id) {
    setBuilderOpen(false);
    setEditingDashboardId(null);
    setActiveId(id);
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
  // 2026-07-19 요청: 위젯을 드래그/리사이즈하는 편집 캔버스(DashboardBuilder)에서는
  // Errors/Total Logs/Warnings/탐지 시나리오 카드를 클릭해도 아무 반응이 없어야
  // 한다(레이아웃을 짜는 중인데 클릭이 데이터 필터로 새버리면 헷갈린다는 취지) -
  // 기본 모드(아래 kpiTotalWidget 등)에서는 클릭하면 KPI 필터가 걸리는 기존
  // 동작이 그대로 유지된다.
  //
  // 2026-07-19(2차) 수정: 처음엔 "이 함수로 렌더링되는 모든 곳"을 편집 중으로
  // 취급해서, 이미 저장해둔 프로필을 그냥 "적용해서 보기만" 하는
  // CustomDashboardView(레이아웃 편집이 아니라 기본 모드처럼 고정된 뷰)까지도
  // 버튼이 죽어있었다 - 편집 캔버스(DashboardBuilder)와 적용된 프로필 보기
  // (CustomDashboardView)는 다른 상태인데 같은 렌더러를 공유하다 보니 편집
  // 전용으로 만든 "클릭 무효화"가 보기 모드에도 새버린 것. interactive 플래그로
  // 구분한다 - true면(CustomDashboardView가 넘김) 기본 모드와 똑같이 onClick/
  // active를 붙여서 KPI 필터가 걸리고, 필터 적용 중이면 눌린 상태(active)도
  // 정확히 반영된다. false(기본값, DashboardBuilder가 씀)면 기존처럼 onClick을
  // 아예 안 넘겨서 KpiCard가 button 대신 div로 렌더링된다(KpiCard 정의의
  // `const Tag = onClick ? "button" : "div"` 참고) - 드래그/리사이즈는
  // WidgetFrame의 별도 드래그 핸들이 담당해서 이 카드의 onClick 유무와 무관하게
  // 그대로 가능하다.
  // onChartTypeChange(2026-07-19): 적용된 커스텀 프로필을 "보기만" 할 때도
  // 차트 타입 전환은 기본 모드 위젯처럼 카드 헤더에 항상 보이는 버튼으로 하고
  // 싶다는 요청 - 이전엔 편집 캔버스(DashboardBuilder)의 WidgetFrame hover
  // 오버레이가 전담했는데, 그 오버레이 자체를 적용된 화면에서 없앴더니
  // (CustomDashboardView 참고) 전환 수단이 아예 사라져버렸었다. 이 콜백이
  // 있으면(=CustomDashboardView가 넘김) 각 차트 컴포넌트가 자기 Card 헤더에
  // 토글을 그대로 띄우고 거기로 변경을 흘려보낸다 - 편집 캔버스(콜백 없이
  // 호출, WidgetFrame이 hover 토글을 따로 담당)에서는 중복으로 안 뜬다.
  function renderWidgetContent(type, chartType, interactive = false, onChartTypeChange) {
    switch (type) {
      case "kpi-total":
        return (
          <KpiCard
            label="Total Logs"
            labelSuffix={` (${preset.label})`}
            value={kpiStatus === "ready" ? `${(kpi.current.total ?? 0).toLocaleString()}건` : "-"}
            delta={kpiStatus === "ready" && kpi.delta_pct.total != null ? `${Math.abs(kpi.delta_pct.total)}%` : undefined}
            positive={kpiStatus === "ready" ? (kpi.delta_pct.total ?? 0) >= 0 : true}
            onClick={interactive ? () => setKpiFilter("ALL") : undefined}
            active={interactive ? kpiFilter === "ALL" : undefined}
            labelTone="sky"
          />
        );
      case "kpi-errors":
        return (
          <KpiCard
            label="Errors"
            labelSuffix=" (Major~Critical)"
            value={kpiStatus === "ready" ? `${(kpi.current.errors ?? 0).toLocaleString()}건` : "-"}
            delta={kpiStatus === "ready" && kpi.delta_pct.errors != null ? `${Math.abs(kpi.delta_pct.errors)}%` : undefined}
            positive={kpiStatus === "ready" ? (kpi.delta_pct.errors ?? 0) <= 0 : false}
            onClick={interactive ? () => setKpiFilter("ERROR") : undefined}
            active={interactive ? kpiFilter === "ERROR" : undefined}
            accent="critical"
            labelTone="critical"
          />
        );
      case "kpi-warnings":
        return (
          <KpiCard
            label="Warnings"
            labelSuffix=" (Minor)"
            value={kpiStatus === "ready" ? `${(kpi.current.warnings ?? 0).toLocaleString()}건` : "-"}
            delta={kpiStatus === "ready" && kpi.delta_pct.warnings != null ? `${Math.abs(kpi.delta_pct.warnings)}%` : undefined}
            positive={kpiStatus === "ready" ? (kpi.delta_pct.warnings ?? 0) <= 0 : true}
            onClick={interactive ? () => setKpiFilter("WARNING") : undefined}
            active={interactive ? kpiFilter === "WARNING" : undefined}
            labelTone="high"
          />
        );
      case "kpi-sources":
        return (
          <KpiCard
            label="탐지 시나리오"
            value={scenariosStatus === "ready" ? `${enabledScenarioCount}/${totalScenarioCount}개` : "-"}
            onClick={interactive ? () => setKpiFilter("SOURCES") : undefined}
            active={interactive ? kpiFilter === "SOURCES" : undefined}
          />
        );
      case "log-volume":
        return <LogVolumeChart rangeKey={rangeKey} kpiFilter={kpiFilter} chartType={chartType || "area"} />;
      case "level-distribution":
        return (
          <RealLevelDistributionChart
            hours={hours}
            kpiFilter={kpiFilter}
            chartType={chartType || "bar"}
            onChartTypeChangeExternal={onChartTypeChange}
          />
        );
      case "donut-source":
        return (
          <DetectionSourceDonutCompact
            lookbackMs={preset.lookbackMs}
            kpiFilter={kpiFilter}
            chartType={chartType || "donut"}
            onChartTypeChangeExternal={onChartTypeChange}
          />
        );
      case "donut-severity":
        return (
          <SeverityDonutCompact hours={hours} chartType={chartType || "donut"} onChartTypeChangeExternal={onChartTypeChange} />
        );
      case "donut-k8s-namespace":
        return (
          <LayerAttackStatsCompact
            scenarios={scenarios}
            status={scenariosStatus}
            error={scenariosError}
            controlled
            chartType={chartType || "bar"}
            onChartTypeChangeExternal={onChartTypeChange}
          />
        );
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
        return <ErrorRateGauge events={displayEvents} title="Error Rate" subtitle="Major~Critical 비중" fillHeight />;
      case "geo-summary":
        return <GeoSummaryCard fillHeight />;
      case "activity-flow":
        return <LiveActivityTree />;
      default:
        return null;
    }
  }

  // 기본 모드 전용 고정 위젯들 - chartType 없이 각 컴포넌트 자체 기본값만 쓴다.
  // 커스텀 대시보드의 chartType 변경과는 완전히 분리된 별도 변수들.
  const kpiTotalWidget = (
    <KpiCard
      label="Total Logs"
      labelSuffix={` (${preset.label})`}
      value={kpiStatus === "ready" ? `${(kpi.current.total ?? 0).toLocaleString()}건` : "-"}
      delta={kpiStatus === "ready" && kpi.delta_pct.total != null ? `${Math.abs(kpi.delta_pct.total)}%` : undefined}
      positive={kpiStatus === "ready" ? (kpi.delta_pct.total ?? 0) >= 0 : true}
      onClick={() => setKpiFilter("ALL")}
      active={kpiFilter === "ALL"}
      labelTone="sky"
    />
  );
  const kpiErrorsWidget = (
    <KpiCard
      label="Errors"
      labelSuffix=" (Major~Critical)"
      value={kpiStatus === "ready" ? `${(kpi.current.errors ?? 0).toLocaleString()}건` : "-"}
      delta={kpiStatus === "ready" && kpi.delta_pct.errors != null ? `${Math.abs(kpi.delta_pct.errors)}%` : undefined}
      positive={kpiStatus === "ready" ? (kpi.delta_pct.errors ?? 0) <= 0 : false}
      onClick={() => setKpiFilter("ERROR")}
      active={kpiFilter === "ERROR"}
      accent="critical"
      labelTone="critical"
    />
  );
  const kpiWarningsWidget = (
    <KpiCard
      label="Warnings"
      labelSuffix=" (Minor)"
      value={kpiStatus === "ready" ? `${(kpi.current.warnings ?? 0).toLocaleString()}건` : "-"}
      delta={kpiStatus === "ready" && kpi.delta_pct.warnings != null ? `${Math.abs(kpi.delta_pct.warnings)}%` : undefined}
      positive={kpiStatus === "ready" ? (kpi.delta_pct.warnings ?? 0) <= 0 : true}
      onClick={() => setKpiFilter("WARNING")}
      active={kpiFilter === "WARNING"}
      labelTone="high"
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
              setActiveId={selectDashboardFromMenu}
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
          onChartTypeCommit={(widgets) => updateDashboard(activeDashboard.id, { widgets })}
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-4">
            {kpiErrorsWidget}
            {kpiWarningsWidget}
            {kpiTotalWidget}
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
