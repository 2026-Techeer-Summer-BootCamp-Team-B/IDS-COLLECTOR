import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Sector } from "recharts";
import { BarChart3, PieChart as PieChartIcon, FileSpreadsheet, FileText, Search, CheckCircle2, Ban, Layers, ChevronUp, ChevronDown, AlertTriangle, AlertOctagon, Activity, Crosshair } from "lucide-react";
import { SeverityBadge, SourceBadge, SEVERITY_META } from "../components/badges";
import { CHART_COLORS, forTheme, DONUT_PALETTE, donutPalette } from "../data/theme";
import { useTheme } from "../hooks/useTheme";
import { usePersistedPreference } from "../hooks/usePersistedPreference";
import { exportIncidentCSV, exportIncidentPDF } from "../lib/exportIncident";
import { useIncidents } from "../hooks/useIncidents";
import { useIncidentCounts } from "../hooks/useIncidentCounts";
import { useIncidentsSocket } from "../hooks/useIncidentsSocket";
import { useIncidentTimeline } from "../hooks/useIncidentTimeline";
import { useScenarios } from "../hooks/useScenarios";
import { useBannedIps } from "../hooks/useBannedIps";
import { useTopIps } from "../hooks/useTopIps";
import { getModuleMeta } from "../data/moduleMeta";
import { getRealSeverityMeta } from "../data/realSeverity";
import { apiPatch, apiPost, ApiError } from "../lib/authApi";
import { DISPLAY_TIMEZONE } from "../lib/timezone";
import { groupSimilarIncidents, isIpKeyType } from "../lib/incidentGrouping";
import { ChartHoverPanel } from "../components/HoverPanel";
import { useAutoCycleIndex, useAnimatedFills, useGrowPulse, renderGlowActiveShape, useBarHoverIndex } from "./LogDashboard";

// incidents.severity(1~4, event.severity와 같은 실 스케일)를 badges.jsx의
// SEVERITY_META 키(CRITICAL/HIGH/MEDIUM/LOW)로 별칭 처리.
const SEVERITY_TO_BADGE_KEY = { 4: "CRITICAL", 3: "HIGH", 2: "MEDIUM", 1: "LOW" };
function severityBadgeKey(sev) {
  return SEVERITY_TO_BADGE_KEY[sev] || "LOW";
}

// 2026-07-17(5차): "심각도 분포" 도넛이 REAL_SEVERITY_LEVELS 원래 라벨
// (Critical/Major/Minor/Info)을 그대로 써서, 같은 화면의 공격 스토리라인
// 카드 배지(CRITICAL/HIGH/MEDIUM/LOW)와 단어가 달라 보였다는 피드백 -
// 도넛도 같은 배지 라벨 체계로 통일한다.
const SEVERITY_BADGE_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

// 2026-07-16: "전체 인시던트/Open/조사중/종결"처럼 한/영이 섞여있던 걸 실제
// 인시던트 관리 툴(PagerDuty/Opsgenie류)에서 쓰는 영문 상태명으로 통일 -
// STATUS_META(도넛 차트 라벨)와도 이제 같은 용어를 쓴다("Closed" -> "Resolved").
const STATUS_LABEL = { open: "Open", investigating: "Investigating", closed: "Resolved" };
const STATUS_META = {
  open: { label: "Open", color: "#FF1F4B" },
  investigating: { label: "Investigating", color: "#F5E400" },
  closed: { label: "Resolved", color: "#00FFA6" },
};

// 2026-07-19: "조사완료 처리"를 누르면 바로 Resolved로 넘어가버려서 실제로
// 무슨 조치를 취했는지 안 남는다는 피드백 - investigating 상태에서 바로
// closed로 보내지 않고, 조치 유형을 먼저 고르게 한다. ip_ban을 고르면
// handleBanSourceIp(이미 있는 실제 POST /banned-ips 호출)를 같이 실행해서
// "그냥 라벨만 붙이는 게" 아니라 진짜 조치가 나가게 한다. 나머지 카테고리는
// 백엔드에 대응하는 액션이 없어(버그트래커 연동 등) status를 closed로
// 전환하는 것 자체가 실제 조치다. 카테고리 자체는 백엔드 스키마에 컬럼이
// 없어 세션 동안만 유지되는 프론트 전용 상태(resolutionCategories)로 둔다.
const RESOLUTION_CATEGORIES = [
  { key: "ip_ban", label: "IP 밴" },
  { key: "bug_fix", label: "버그 수정" },
  { key: "false_positive", label: "오탐(정상 트래픽)" },
  { key: "policy_update", label: "정책 업데이트" },
];
const RESOLUTION_CATEGORY_LABEL = Object.fromEntries(RESOLUTION_CATEGORIES.map((c) => [c.key, c.label]));
function tooltipStyle(C) {
  // LogDashboard.jsx의 동일 함수와 같은 이유 - 순수 블랙 테마에서 border:none이면
  // 배경과 안 구분됨 (2026-07-16, 도넛 차트 호버 가시성 피드백).
  return { background: C.surfaceAlt, border: `1px solid ${C.faint}`, borderRadius: 8, color: C.fg, fontSize: 12 };
}

function MiniKpi({ label, value, sub, color, onClick, active = false, accent = "mint" }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const Tag = onClick ? "button" : "div";
  const accentBorder = accent === "critical" ? "border-dash-critical/50" : "border-dash-mint/50";
  return (
    <Tag
      onClick={onClick}
      className={`rounded-2xl p-4 flex-1 min-w-[160px] text-left transition-colors border ${
        onClick ? "cursor-pointer" : ""
      } ${
        active
          ? `bg-dash-bg/60 ${accentBorder}`
          : `bg-dash-surface border-transparent ${onClick ? "hover:bg-dash-surfaceAlt/60" : ""}`
      }`}
    >
      <p className="text-dash-muted text-xs mb-1.5">{label}</p>
      <p className="text-lg font-semibold truncate" style={{ color: color || C.fg }}>
        {value}
      </p>
      {sub && <p className="text-dash-muted text-[11px] mt-0.5">{sub}</p>}
    </Tag>
  );
}

// 상태(open/investigating/closed) 필터 버튼 4개. 2026-07-24 이전엔 GET
// /incidents로 받은 전체 목록에서 .filter()로 세었는데, 인시던트가 수천 건으로
// 늘면서(더미 생성기가 계속 발화) 그 전체 fetch 자체가 느려져 이 카운트도 같이
// 늦게 떴다(useIncidentCounts.js, GET /incidents/stats Postgres 집계로 분리 -
// 카드 목록/그룹핑용 전체 fetch(useIncidents)와 개수는 이제 완전히 독립).
// Top 상관 규칙/Top 공격 IP는 클릭해도 필터링되지 않는 순수 정보 카드라 이
// 버튼 그리드와 섞으면 "이것도 눌리나?" 하는 오해를 주고 톤도 안 맞았다
// (2026-07-16) - TopSignalsCard로 완전히 분리했다.
function IncidentKpiRow({ counts, statusFilter, onFilterChange }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const openCount = counts.byStatus.open ?? 0;
  const investigatingCount = counts.byStatus.investigating ?? 0;
  const closedCount = counts.byStatus.closed ?? 0;

  return (
    <div className="flex flex-wrap gap-4">
      <MiniKpi
        label="Open"
        value={openCount}
        color={C.critical}
        accent="critical"
        onClick={() => onFilterChange("open")}
        active={statusFilter === "open"}
      />
      <MiniKpi
        label="Investigating"
        value={investigatingCount}
        onClick={() => onFilterChange("investigating")}
        active={statusFilter === "investigating"}
      />
      <MiniKpi
        label="Resolved"
        value={closedCount}
        color={C.mint}
        onClick={() => onFilterChange("closed")}
        active={statusFilter === "closed"}
      />
      <MiniKpi label="Total" value={counts.total} onClick={() => onFilterChange("ALL")} active={statusFilter === "ALL"} />
    </div>
  );
}

// Top 상관 규칙/Top 공격 IP - 필터 버튼이 아니라 순수 정보 카드라 클릭 가능한
// MiniKpi 그리드와는 분리된 별도 섹션으로 뺐다(2026-07-16). 이 컴포넌트 안의
// bg-dash-bg 타일 패턴은 이 파일 아래쪽 "인시던트 상세" 패널의 상관 규칙/MITRE
// 경로/상관 키 타일과 같은 스타일 - 이미 검증된 "정보 전용" 톤을 재사용.
// 2026-07-16: 카드가 너무 크다는 피드백 - 패딩/폰트를 한 단계씩 줄이고
// 라벨+값+부가정보를 한 줄에 압축했다(세로 2줄 -> 1.5줄 수준).
function TopSignalsCard({ topScenario, topIp }) {
  return (
    <div className="bg-dash-surface rounded-xl px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5">
        <span className="text-dash-faint text-[10px] uppercase tracking-wide shrink-0">최근 7일 시그널</span>
        <span className="flex items-baseline gap-1.5 text-xs min-w-0">
          <span className="text-dash-muted shrink-0">Top 상관 규칙</span>
          <span className="text-dash-fg font-medium truncate">{topScenario?.name || "-"}</span>
          {topScenario && <span className="text-dash-faint text-[11px] shrink-0">({topScenario.hit_count}건)</span>}
        </span>
        <span className="flex items-baseline gap-1.5 text-xs min-w-0">
          <span className="text-dash-muted shrink-0">Top 공격 IP</span>
          <span className="text-dash-fg font-medium truncate">{topIp?.name || "-"}</span>
          {topIp && <span className="text-dash-faint text-[11px] shrink-0">({topIp.count}건)</span>}
        </span>
      </div>
    </div>
  );
}

function DistributionTypeToggle({ value, onChange }) {
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      {[
        { key: "donut", label: "도넛", icon: PieChartIcon },
        { key: "bar", label: "막대", icon: BarChart3 },
      ].map((option) => {
        const Icon = option.icon;
        return (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors ${
            value === option.key ? "bg-dash-mint/25 text-dash-mint" : "text-dash-muted hover:text-dash-fg hover:bg-dash-surfaceAlt"
          }`}
        >
          <Icon size={11} strokeWidth={2.5} />
          {option.label}
        </button>
        );
      })}
    </div>
  );
}

function SeverityDonut({ bySeverity }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const [chartType, setChartType] = usePersistedPreference("sentinel-ops:chart-type:incident-severity", "donut", ["donut", "bar"]);
  const data = useMemo(() => {
    const counts = {};
    Object.entries(bySeverity).forEach(([sev, count]) => {
      const key = severityBadgeKey(Number(sev));
      counts[key] = (counts[key] || 0) + count;
    });
    // 공격 스토리라인 카드 배지(CRITICAL/HIGH/MEDIUM/LOW)와 같은 라벨을 쓴다 -
    // 예전엔 REAL_SEVERITY_LEVELS 원래 이름(Critical/Major/Minor/Info)을 써서
    // 같은 화면 안에서 같은 심각도가 다른 단어로 보였다.
    return SEVERITY_BADGE_ORDER.filter((key) => counts[key]).map((key, i) => ({
      key,
      label: SEVERITY_META[key].label,
      count: counts[key],
      // Overview의 도넛들(SeverityDonutCompact 등)과 같은 톤 다운 순환 팔레트로
      // 통일 - severity 배지 등 다른 곳의 의미색(빨강=critical 등)과는 별개.
      color: donutPalette(theme)[i % DONUT_PALETTE.length],
    }));
  }, [bySeverity, theme]);
  const total = data.reduce((s, d) => s + d.count, 0);
  const [activeIndex, setPaused, focusIndex, blurIndex, highlighting] = useAutoCycleIndex(chartType === "donut" ? data.length : 0);
  const targetFills = useMemo(() => data.map((d, i) => (!highlighting || i === activeIndex ? d.color : C.donutDim)), [data, highlighting, activeIndex, C.donutDim]);
  const animatedFills = useAnimatedFills(targetFills);
  const growth = useGrowPulse(activeIndex);
  const [hoveredBarIndex, barHoverHandlers] = useBarHoverIndex();

  return (
    <div className="bg-dash-surface rounded-2xl p-5">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="text-dash-fg text-sm font-semibold mb-1 flex items-center gap-1.5">
            <AlertOctagon className="w-4 h-4 shrink-0" strokeWidth={2} />
            심각도 분포
          </h3>
          <p className="text-dash-muted text-xs">전체 인시던트 · 총 {total}건</p>
        </div>
        <DistributionTypeToggle value={chartType} onChange={setChartType} />
      </div>
      {total === 0 ? (
        <p className="text-dash-muted text-xs">인시던트가 없습니다.</p>
      ) : chartType === "bar" ? (
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} {...barHoverHandlers}>
            <CartesianGrid stroke={C.surfaceAlt} vertical={false} />
            <XAxis dataKey="label" stroke={C.muted} tickLine={false} axisLine={false} fontSize={10} interval={0} />
            <YAxis stroke={C.muted} tickLine={false} axisLine={false} fontSize={11} allowDecimals={false} />
            <Tooltip
              content={<ChartHoverPanel theme={theme} />}
              allowEscapeViewBox={{ x: true, y: true }}
              reverseDirection={{ x: false, y: false }}
              offset={0}
              isAnimationActive={false}
              wrapperStyle={{ pointerEvents: "none" }}
              cursor={{ fill: C.surfaceAlt, opacity: theme === "dark" ? 1 : 0.5 }}
            />
            <Bar dataKey="count" radius={[6, 6, 0, 0]} isAnimationActive animationDuration={700} animationEasing="ease-out">
              {data.map((d, i) => <Cell key={d.key} fill={hoveredBarIndex !== null && i !== hoveredBarIndex ? C.donutDim : d.color} style={{ transition: "fill 180ms ease-out" }} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex items-center gap-4">
          <ResponsiveContainer width={132} height={132}>
            <PieChart onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
              <Pie data={data} dataKey="count" nameKey="label" innerRadius={32} outerRadius={52} startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false} activeIndex={activeIndex} activeShape={(props) => renderGlowActiveShape(props, growth)} onMouseEnter={(_, index) => focusIndex(index)} onMouseLeave={blurIndex}>
                {data.map((d) => (
                  <Cell key={d.key} fill={animatedFills[data.indexOf(d)]} stroke={theme === "light" ? "#FFFFFF" : C.surfaceAlt} strokeWidth={0.7} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 space-y-1.5 text-xs">
            {data.map((d, i) => (
              <div key={d.key} onMouseEnter={() => focusIndex(i)} onMouseLeave={blurIndex} className={`flex items-center justify-between gap-2 rounded-md px-1 -mx-1 py-0.5 transition-colors duration-200 ease-in-out ${i === activeIndex ? "bg-dash-surfaceAlt/60" : ""}`} style={theme === "dark" && i === activeIndex ? { backgroundColor: C.surfaceAlt } : undefined}>
                <span className={`flex items-center gap-1.5 truncate transition-colors duration-200 ease-in-out ${!highlighting ? i === activeIndex ? "text-dash-fg" : "text-dash-muted" : i === activeIndex ? "text-dash-fg font-bold" : ""}`} style={highlighting && i !== activeIndex ? { color: C.donutDim } : undefined}>
                  <span className="w-2 h-2 rounded-full inline-block shrink-0 transition-colors duration-200 ease-in-out" style={{ backgroundColor: highlighting && i !== activeIndex ? C.donutDim : d.color }} />
                  {d.label}
                </span>
                <span className="text-dash-fg">{d.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusDonut({ byStatus }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const [chartType, setChartType] = usePersistedPreference("sentinel-ops:chart-type:incident-status", "donut", ["donut", "bar"]);
  const data = useMemo(() => {
    return Object.entries(STATUS_META)
      .filter(([key]) => byStatus[key])
      .map(([key, meta], i) => ({
        key,
        label: meta.label,
        count: byStatus[key],
        color: donutPalette(theme)[i % DONUT_PALETTE.length],
      }));
  }, [byStatus, theme]);
  const total = data.reduce((s, d) => s + d.count, 0);
  const [activeIndex, setPaused, focusIndex, blurIndex, highlighting] = useAutoCycleIndex(chartType === "donut" ? data.length : 0);
  const targetFills = useMemo(() => data.map((d, i) => (!highlighting || i === activeIndex ? d.color : C.donutDim)), [data, highlighting, activeIndex, C.donutDim]);
  const animatedFills = useAnimatedFills(targetFills);
  const growth = useGrowPulse(activeIndex);
  const [hoveredBarIndex, barHoverHandlers] = useBarHoverIndex();

  return (
    <div className="bg-dash-surface rounded-2xl p-5">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="text-dash-fg text-sm font-semibold mb-1 flex items-center gap-1.5">
            <Activity className="w-4 h-4 shrink-0" strokeWidth={2} />
            상태별 분포
          </h3>
          <p className="text-dash-muted text-xs">Open / Investigating / Closed · 총 {total}건</p>
        </div>
        <DistributionTypeToggle value={chartType} onChange={setChartType} />
      </div>
      {total === 0 ? (
        <p className="text-dash-muted text-xs">인시던트가 없습니다.</p>
      ) : chartType === "bar" ? (
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} {...barHoverHandlers}>
            <CartesianGrid stroke={C.surfaceAlt} vertical={false} />
            <XAxis dataKey="label" stroke={C.muted} tickLine={false} axisLine={false} fontSize={10} interval={0} />
            <YAxis stroke={C.muted} tickLine={false} axisLine={false} fontSize={11} allowDecimals={false} />
            <Tooltip
              content={<ChartHoverPanel theme={theme} />}
              allowEscapeViewBox={{ x: true, y: true }}
              reverseDirection={{ x: false, y: false }}
              offset={0}
              isAnimationActive={false}
              wrapperStyle={{ pointerEvents: "none" }}
              cursor={{ fill: C.surfaceAlt, opacity: theme === "dark" ? 1 : 0.5 }}
            />
            <Bar dataKey="count" radius={[6, 6, 0, 0]} isAnimationActive animationDuration={700} animationEasing="ease-out">
              {data.map((d, i) => <Cell key={d.key} fill={hoveredBarIndex !== null && i !== hoveredBarIndex ? C.donutDim : d.color} style={{ transition: "fill 180ms ease-out" }} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex items-center gap-4">
          <ResponsiveContainer width={132} height={132}>
            <PieChart onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
              <Pie data={data} dataKey="count" nameKey="label" innerRadius={32} outerRadius={52} startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false} activeIndex={activeIndex} activeShape={(props) => renderGlowActiveShape(props, growth)} onMouseEnter={(_, index) => focusIndex(index)} onMouseLeave={blurIndex}>
                {data.map((d) => (
                  <Cell key={d.key} fill={animatedFills[data.indexOf(d)]} stroke={theme === "light" ? "#FFFFFF" : C.surfaceAlt} strokeWidth={0.7} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 space-y-1.5 text-xs">
            {data.map((d, i) => (
              <div key={d.key} onMouseEnter={() => focusIndex(i)} onMouseLeave={blurIndex} className={`flex items-center justify-between gap-2 rounded-md px-1 -mx-1 py-0.5 transition-colors duration-200 ease-in-out ${i === activeIndex ? "bg-dash-surfaceAlt/60" : ""}`} style={theme === "dark" && i === activeIndex ? { backgroundColor: C.surfaceAlt } : undefined}>
                <span className={`flex items-center gap-1.5 truncate transition-colors duration-200 ease-in-out ${!highlighting ? i === activeIndex ? "text-dash-fg" : "text-dash-muted" : i === activeIndex ? "text-dash-fg font-bold" : ""}`} style={highlighting && i !== activeIndex ? { color: C.donutDim } : undefined}>
                  <span className="w-2 h-2 rounded-full inline-block shrink-0 transition-colors duration-200 ease-in-out" style={{ backgroundColor: highlighting && i !== activeIndex ? C.donutDim : d.color }} />
                  {d.label}
                </span>
                <span className="text-dash-fg">{d.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// 공격 유형(=적중된 상관 규칙)별 인시던트 통계 - 예전엔 TopSignalsCard가
// "1위 규칙 이름 + 건수"만 텍스트 한 줄로 보여줘서 전체 분포 감이 안 왔다는
// 피드백(2026-07-16) - 상위 5개 규칙을 막대그래프로 보여준다. AdminAuditView의
// RuleRankingBarChart와 데이터 소스(GET /scenarios, hit_count)는 같지만, 그쪽은
// "룰 관리자" 관점(토글 포함 전체 목록)이고 여기는 "이 인시던트들이 왜
// 만들어졌는지" 관점이라 컴포넌트를 공유하지 않고 이 파일 안에 따로 둔다.
function TopAttackTypesBarChart({ scenarios }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const [hoveredBarIndex, barHoverHandlers] = useBarHoverIndex();
  const data = useMemo(
    () =>
      [...scenarios]
        .filter((s) => s.hit_count > 0)
        .sort((a, b) => b.hit_count - a.hit_count)
        .slice(0, 5)
        .map((s, i) => ({
          id: s.id,
          name: s.name,
          hits: s.hit_count,
          // Cell 색은 SVG에만 적용되고 Tooltip payload에는 자동으로 복사되지 않는다.
          // 패널의 색 점도 같은 팔레트를 읽도록 데이터 자체에 명시한다.
          // DONUT_PALETTE 5번째 값(#8890B5)이 muted/low와 같은 회색빛 톤이라 5개를
          // 꽉 채운 랭킹에서 유독 하나만 죽어 보인다는 피드백(2026-07-21) - 5번째
          // 자리만 팔레트의 pink로 바꿔 다섯 막대 모두 또렷하게 구분되게 한다.
          color: i < 4 ? donutPalette(theme)[i] : C.pink,
        })),
    [scenarios, theme, C.pink]
  );

  return (
    <div className="bg-dash-surface rounded-2xl p-5">
      <h3 className="text-dash-fg text-sm font-semibold mb-1 flex items-center gap-1.5">
        <Crosshair className="w-4 h-4 shrink-0" strokeWidth={2} />
        공격 유형별 적중 통계 TOP 5
      </h3>
      <p className="text-dash-muted text-xs mb-3">
        어떤 상관 규칙(공격 패턴)이 인시던트를 가장 많이 만들었는지 · GET /scenarios 기준
      </p>
      {/* 2026-07-16(8차): "높이를 조금 줄여도 될 거 같다"는 피드백 - 행당
          높이를 44 -> 36, 최소 높이를 180 -> 160으로 줄였다. */}
      {data.length === 0 ? (
        <p className="text-dash-muted text-xs py-3">적중된 상관 규칙이 없습니다.</p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(160, data.length * 36)}>
          <BarChart data={data} layout="vertical" margin={{ left: 4, right: 28, top: 4, bottom: 4 }} {...barHoverHandlers}>
            <CartesianGrid stroke={C.surfaceAlt} horizontal={false} />
            <XAxis type="number" stroke={C.muted} tickLine={false} axisLine={false} fontSize={10} allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="name"
              stroke={C.muted}
              tickLine={false}
              axisLine={false}
              fontSize={11}
              width={140}
              tickFormatter={(v) => (v.length > 16 ? `${v.slice(0, 16)}…` : v)}
            />
            <Tooltip
              content={<ChartHoverPanel theme={theme} labelFormatter={(label, payload) => payload?.[0]?.payload?.name ?? label} formatter={(value) => [`${value}건`, "적중 건수"]} />}
              allowEscapeViewBox={{ x: true, y: true }}
              reverseDirection={{ x: false, y: false }}
              offset={0}
              wrapperStyle={{ pointerEvents: "none" }}
              cursor={{ fill: C.surfaceAlt, opacity: theme === "dark" ? 1 : 0.5 }}
              isAnimationActive={false}
            />
            <Bar dataKey="hits" radius={[0, 6, 6, 0]} isAnimationActive animationDuration={700} animationEasing="ease-out">
              {data.map((d, i) => (
                <Cell key={d.id} fill={hoveredBarIndex !== null && i !== hoveredBarIndex ? C.donutDim : d.color} style={{ transition: "fill 180ms ease-out" }} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// 2026-07-16: 좌측 리스트 폭(320px)에 비해 카드 내용(뱃지+제목+MITRE 태그행+
// 상관키/시각 줄)이 너무 빽빽해서 리스트가 필요 이상으로 넓어 보인다는 피드백 -
// MITRE 태그행/상관키 텍스트/중복되는 StatusDot을 빼고 심각도+상태+제목+시각만
// 남겨 한 카드를 3줄로 줄였다. 상세 정보(MITRE 경로, 상관 키 등)는 클릭하면
// 오른쪽 상세 패널에 이미 다 나오므로 목록에서는 없어도 된다.
function IncidentCard({ incident, active, onClick }) {
  const { theme } = useTheme();
  const meta = getRealSeverityMeta(incident.severity);
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg px-2.5 py-2 border-l-4 transition-colors ${
        active ? "bg-dash-surfaceAlt" : "bg-dash-surface hover:bg-dash-surfaceAlt/60"
      }`}
      style={{ borderLeftColor: forTheme(meta.color, theme) }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <SeverityBadge level={severityBadgeKey(incident.severity)} />
        <span className="text-dash-faint text-[10px]">{STATUS_LABEL[incident.status]}</span>
      </div>
      <p className="text-dash-fg text-xs font-medium truncate">{incident.title}</p>
      <p className="text-dash-faint text-[10px] mt-0.5">
        {new Date(incident.updated_at).toLocaleString("ko-KR", {
          timeZone: DISPLAY_TIMEZONE,
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </p>
    </button>
  );
}

// 2026-07-17: "유사 항목 묶어보기"가 켜졌을 때 카드 하나 대신 그룹(같은 상관
// 규칙 + 같은 상관 키, IP는 대역 오차범위 내면 같은 그룹) 단위로 렌더링.
// count===1이면 평범한 IncidentCard와 동일하게 동작(클릭 시 바로 선택),
// count>1이면 클릭 시 펼쳐서 묶인 인시던트들을 인덴트된 IncidentCard 목록으로
// 보여준다 - 그룹 헤더를 누르면 대표(가장 최신) 인시던트가 동시에 선택돼
// 오른쪽 상세 패널도 바로 갱신된다.
function GroupedIncidentCard({ group, expanded, onToggleExpand, selectedId, onSelectIncident }) {
  const { theme } = useTheme();
  const rep = group.representative;
  const meta = getRealSeverityMeta(rep.severity);

  function handleHeaderClick() {
    onSelectIncident(rep.id);
    if (group.count > 1) onToggleExpand();
  }

  return (
    <div>
      <button
        onClick={handleHeaderClick}
        className={`w-full text-left rounded-lg px-2.5 py-2 border-l-4 transition-colors ${
          selectedId === rep.id ? "bg-dash-surfaceAlt" : "bg-dash-surface hover:bg-dash-surfaceAlt/60"
        }`}
        style={{ borderLeftColor: forTheme(meta.color, theme) }}
      >
        <div className="flex items-center gap-1.5 mb-1 justify-between">
          <div className="flex items-center gap-1.5 min-w-0">
            <SeverityBadge level={severityBadgeKey(rep.severity)} />
            <span className="text-dash-faint text-[10px]">{STATUS_LABEL[rep.status]}</span>
          </div>
          {group.count > 1 && (
            <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-dash-mint/15 text-dash-mint">
              ×{group.count}
              <span className="ml-0.5 inline-flex align-middle">
                {expanded ? <ChevronUp size={11} strokeWidth={2.5} /> : <ChevronDown size={11} strokeWidth={2.5} />}
              </span>
            </span>
          )}
        </div>
        <p className="text-dash-fg text-xs font-medium truncate">{rep.title}</p>
        <p className="text-dash-faint text-[10px] mt-0.5 truncate">
          {rep.correlation_key_type}={rep.correlation_key_value}
          {group.count > 1 ? ` 외 유사 IP/키 ${group.count - 1}건` : ""}
        </p>
      </button>
      {expanded && group.count > 1 && (
        <div className="pl-2 mt-1 mb-1 space-y-1 border-l-2 border-dash-surfaceAlt ml-2">
          {group.members.map((inc) => (
            <IncidentCard key={inc.id} incident={inc} active={inc.id === selectedId} onClick={() => onSelectIncident(inc.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function StorylineEntry({ entry, isLast }) {
  const lines = String(entry.detail || "").split("\n");
  return (
    <div className="relative pl-14 pb-6 last:pb-0">
      <span className="absolute left-0 top-0.5 text-dash-faint text-xs w-10 text-right">{entry.offset}</span>
      <span className="absolute left-11 top-1.5 w-2 h-2 rounded-full bg-dash-mint" />
      {!isLast && <span className="absolute left-[47px] top-4 bottom-0 w-px bg-dash-surfaceAlt" />}
      <div className="bg-dash-surface rounded-xl p-3.5">
        <div className="flex items-center justify-between mb-1.5">
          <SourceBadge source={entry.source} />
          <span className="text-dash-faint text-[10px]">{entry.mitre}</span>
        </div>
        <p className="text-dash-fg text-sm font-medium mb-1">{entry.title}</p>
        {lines.map((line, i) => (
          <p key={i} className="text-dash-muted text-xs font-mono leading-relaxed">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

/**
 * Incidents 뷰 — GET /incidents(useIncidentsSocket.js가 ?since= 폴링) + GET
 * /incidents/{id}/timeline 실데이터 연동. 상태(open/investigating/closed)는 실제 Postgres 상태 머신을
 * 그대로 반영하고(PATCH /incidents/{id}/status), "소스 IP 차단"은 POST
 * /banned-ips로 감사 트레일을 남긴다(실제 트래픽 차단은 아님).
 *
 * pushToast: App.jsx의 토스트 시스템(선택) — 없으면 조용히 동작.
 */
export default function IncidentsView({ pushToast, pendingIncident }) {
  const { incidents, status, error, hasMore, loadingMore, loadMore, reload } = useIncidents();
  // KPI 행("Open"/"Investigating"/"Resolved"/"Total")과 "심각도 분포"/"상태별
  // 분포" 도넛은 전체 incidents 배열이 아니라 이 서버 집계를 쓴다(2026-07-24,
  // 위 useIncidents가 몇 초씩 걸리는 것과 별개로 개수 세 위젯만이라도 빠르게
  // 뜨게 하기 위함 - useIncidentCounts.js 참고).
  const counts = useIncidentCounts();
  const { scenarios } = useScenarios();
  // status/error는 이제 안 씀 - 목록 UI(BannedIpsTable)가 Admin으로 옮겨갔고
  // 여기서는 "이미 차단됐는지" 판단(alreadyBanned)에만 bannedIps를 쓴다.
  const { bannedIps, reload: reloadBans } = useBannedIps();
  // Incidents는 로그보다 드물게 발생하므로 7일을 "최근"으로 본다(다른 뷰의
  // 24h 위주 range와 다름 - 원래 mock의 "최근 7일" 문구를 그대로 이어받음).
  const { items: topIps } = useTopIps({ lookbackMs: 7 * 24 * 60 * 60 * 1000, limit: 1 });

  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selectedId, setSelectedId] = useState(null);
  // 2026-07-17: "유사 항목 묶어보기" - 같은 상관 규칙 + 같은 상관 키(또는 비슷한
  // 대역의 IP)인 인시던트를 리스트에서 그룹 하나로 접어 보여준다. ipTolerance는
  // ipPrefixKey의 prefixBits와 같은 값(32=정확히 일치, 24=같은 /24 대역(기본,
  // 오차범위 최소), 16=더 넓은 대역).
  const [groupSimilar, setGroupSimilar] = useState(false);
  const [ipTolerance, setIpTolerance] = useState(24);
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  // 조치 유형 선택 플로우(위 RESOLUTION_CATEGORIES 참고) - showCategoryPicker는
  // "조사완료 처리"를 눌러 선택지가 펼쳐진 상태, resolutionCategories는
  // 인시던트 id -> 선택된 카테고리 key 매핑(closed 배지에 표시할 용도).
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [resolutionCategories, setResolutionCategories] = useState({});
  const [resolving, setResolving] = useState(false);

  // 무한 스크롤 - AttackMatrixView.jsx의 pump() 체인과 같은 패턴. 카드 목록
  // 스크롤 박스(아래 scrollBoxRef)가 IntersectionObserver의 root, 그 안 맨
  // 아래 sentinel이 바닥에 걸리면 loadMore()를 부른다. 스크롤바를 드래그해서
  // 단번에 바닥까지 내리면 관찰 콜백이 한 번만 불려도 여러 페이지를 연달아
  // 이어받아야 해서, loadMore()가 돌려주는 hasMore로 재귀 체이닝한다.
  const scrollBoxRef = useRef(null);
  const bottomSentinelRef = useRef(null);
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  const isIntersectingRef = useRef(false);

  useEffect(() => {
    const root = scrollBoxRef.current;
    const target = bottomSentinelRef.current;
    if (!root || !target) return;

    function pump() {
      if (!isIntersectingRef.current) return;
      loadMoreRef.current().then((more) => more && pump());
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        isIntersectingRef.current = entry.isIntersecting;
        if (entry.isIntersecting) pump();
      },
      { root, rootMargin: "200px 0px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  // 아직 안 불러온 나머지 행만큼 빈 공간을 미리 잡아둬서, 페이지를 이어받을
  // 때마다 스크롤바 thumb 크기/위치가 툭툭 튀지 않게 한다(AttackMatrixView.jsx와
  // 같은 기법) - counts.total(서버 집계, useIncidentCounts)이 "전체 몇 건인지"의
  // 기준이고, 평균 행 높이는 실제 렌더링된 카드들에서 측정한다.
  const rowsWrapperRef = useRef(null);
  const [avgRowHeight, setAvgRowHeight] = useState(48);
  useLayoutEffect(() => {
    if (!rowsWrapperRef.current || incidents.length === 0) return;
    const measured = rowsWrapperRef.current.scrollHeight / incidents.length;
    if (measured > 0 && Math.abs(measured - avgRowHeight) > 1) setAvgRowHeight(measured);
  }, [incidents.length]);
  const estimatedRemaining = Math.max(0, (counts.total || incidents.length) - incidents.length);

  function toggleGroupExpanded(key) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  useIncidentsSocket(() => {
    reload();
    counts.reload();
  });

  useEffect(() => {
    if (!selectedId && incidents.length) setSelectedId(incidents[0].id);
  }, [incidents, selectedId]);

  // ATT&CK 매트릭스의 "조치하러 가기" 버튼으로 들어온 경우 - App.jsx가
  // pendingIncident.nonce를 매번 새 값으로 넘겨주므로(같은 인시던트를 다시
  // 눌러도 감지됨), 여기서도 바로 그 인시던트를 선택 상태로 맞춘다.
  // ATT&CK 매트릭스의 "조치하러 가기"와 CRITICAL 토스트의 "스토리라인 보기" 둘 다
  // 이 pendingIncident 하나를 공유한다(2026-07-17) - 후자는 GET
  // /events/{event_id}/incident로 이미 정확한 incident_id를 들고 오므로, 여기서
  // 별도로 이벤트→인시던트 매칭을 할 필요가 없어졌다.
  useEffect(() => {
    if (pendingIncident?.id) setSelectedId(pendingIncident.id);
  }, [pendingIncident]);

  // 다른 인시던트로 전환하면 이전에 펼쳐둔 조치 유형 선택 UI가 그대로 남아있지
  // 않도록 초기화.
  useEffect(() => {
    setShowCategoryPicker(false);
  }, [selectedId]);

  const filteredIncidents = useMemo(
    () => (statusFilter === "ALL" ? incidents : incidents.filter((i) => i.status === statusFilter)),
    [incidents, statusFilter]
  );

  const incidentGroups = useMemo(
    () => (groupSimilar ? groupSimilarIncidents(filteredIncidents, ipTolerance) : null),
    [groupSimilar, filteredIncidents, ipTolerance]
  );

  // 2026-07-19: "유사 항목 묶어보기"가 OFF일 때는 그냥 최신순 flat list라
  // 심각도가 뒤섞여 훑어보기 어렵다는 피드백 - CRITICAL/HIGH/MEDIUM/LOW
  // 섹션으로 나눠서 보여준다. 각 섹션 안에서는 기존 정렬(최신순, incidents가
  // updated_at DESC로 옴)을 그대로 유지.
  const severityGroups = useMemo(() => {
    if (groupSimilar) return null;
    const buckets = { CRITICAL: [], HIGH: [], MEDIUM: [], LOW: [] };
    filteredIncidents.forEach((inc) => {
      buckets[severityBadgeKey(inc.severity)].push(inc);
    });
    return SEVERITY_BADGE_ORDER.map((key) => ({ key, items: buckets[key] })).filter((g) => g.items.length > 0);
  }, [groupSimilar, filteredIncidents]);

  const selected = incidents.find((i) => i.id === selectedId) || null;
  const { timeline, status: timelineStatus } = useIncidentTimeline(selected?.id);

  const topScenario = useMemo(() => scenarios.find((s) => s.hit_count > 0), [scenarios]);
  const selectedScenario = useMemo(
    () => scenarios.find((s) => s.id === selected?.matched_scenario_rule_id) || null,
    [scenarios, selected]
  );
  const alreadyBanned = useMemo(
    () => !!selected && bannedIps.some((b) => b.ip_or_cidr === selected.correlation_key_value),
    [bannedIps, selected]
  );

  function toast(message, tone) {
    pushToast?.(message, tone);
  }

  async function handleAdvanceStatus(nextStatus) {
    if (!selected) return;
    try {
      await apiPatch(`/incidents/${selected.id}/status`, { status: nextStatus });
      toast(`인시던트 상태를 ${STATUS_LABEL[nextStatus]}(으)로 변경했습니다.`, "success");
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "상태 변경에 실패했습니다.", "error");
    }
  }

  async function handleBanSourceIp() {
    if (!selected) return;
    try {
      await apiPost("/banned-ips", { ip_or_cidr: selected.correlation_key_value, reason: `Incident ${selected.id}` });
      toast(`${selected.correlation_key_value} 차단 처리했습니다.`, "success");
      reloadBans();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "IP 차단에 실패했습니다.", "error");
    }
  }

  // investigating -> closed로 바로 넘기지 않고 조치 유형을 먼저 고른 뒤
  // 전환한다. ip_ban을 고르면 이미 있는 실제 차단 API(handleBanSourceIp)를
  // 같이 태워서 "카테고리 라벨만 붙이는" 게 아니라 진짜 조치가 나가게 한다.
  async function handleResolveWithCategory(categoryKey) {
    if (!selected) return;
    setResolving(true);
    try {
      if (categoryKey === "ip_ban" && isIpKeyType(selected.correlation_key_type) && !alreadyBanned) {
        await handleBanSourceIp();
      }
      await apiPatch(`/incidents/${selected.id}/status`, { status: "closed" });
      setResolutionCategories((prev) => ({ ...prev, [selected.id]: categoryKey }));
      toast(`${RESOLUTION_CATEGORY_LABEL[categoryKey]} 조치 후 인시던트를 종결했습니다.`, "success");
      setShowCategoryPicker(false);
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "조치 처리에 실패했습니다.", "error");
    } finally {
      setResolving(false);
    }
  }

  // 2026-07-16: 차단 IP 수동 추가/해제와 그 목록 테이블(BannedIpsTable)은
  // Admin/Audit 페이지로 옮겼다 - "소스 IP 차단" 버튼(handleBanSourceIp, 위)만
  // 조사 중인 인시던트에서 바로 차단하는 용도로 여기 남겨뒀다. bannedIps/
  // reloadBans는 그 버튼의 "이미 차단됐는지" 배지 표시(alreadyBanned)에 여전히
  // 필요해서 useBannedIps 훅 자체는 유지.

  const exportAdapter = useMemo(() => {
    if (!selected) return null;
    return {
      id: selected.id,
      title: selected.title,
      severity: selected.severity,
      status: STATUS_LABEL[selected.status] || selected.status,
      correlationRule: selectedScenario?.name || "-",
      mitrePath: selected.mitre_tactics?.length ? selected.mitre_tactics : ["-"],
      target: `${selected.correlation_key_type}=${selected.correlation_key_value}`,
      sourceIp: isIpKeyType(selected.correlation_key_type) ? selected.correlation_key_value : "-",
      sourceCountry: "-",
      firstDetected: new Date(selected.created_at).toLocaleString("ko-KR", { timeZone: DISPLAY_TIMEZONE }),
      storyline: timeline.map((t) => ({
        offset: `+${Math.max(0, Math.round((new Date(t.added_at) - new Date(selected.created_at)) / 1000))}s`,
        source: getModuleMeta(t.event_module).label,
        title: t.title || "(원본 로그 없음)",
        detail: t.detail || "(원본 로그 없음)",
        mitre: t.mitre_technique_id || "-",
      })),
    };
  }, [selected, selectedScenario, timeline]);

  return (
    <div className="space-y-6">
      {/* 페이지 상단 설명 문구 (2026-07-16) - ATT&CK 페이지의 타이틀+서브타이틀
          패턴을 그대로 가져왔다. */}
      <div>
        <h2 className="text-dash-fg text-base font-semibold mb-1 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" strokeWidth={2} />
          인시던트
        </h2>
        <p className="text-dash-muted text-xs">
          여러 로그(WAS / Falco / K8s Audit)가 상관 규칙에 의해 하나의 사건으로 묶인 인시던트 목록입니다
        </p>
      </div>

      {status === "error" && <p className="text-dash-critical text-xs">{error}</p>}

      <IncidentKpiRow counts={counts} statusFilter={statusFilter} onFilterChange={setStatusFilter} />

      <TopSignalsCard topScenario={topScenario} topIp={topIps[0]} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SeverityDonut bySeverity={counts.bySeverity} />
        <StatusDonut byStatus={counts.byStatus} />
      </div>

      <TopAttackTypesBarChart scenarios={scenarios} />

      {/* 좌측 폭을 320px -> 240px로 줄였다(2026-07-16) - 카드 내용을 핵심만
          남기고 나니 320px는 과하게 넓었고, 그만큼 우측 상세 패널이 좁았다.
          상세 정보는 어차피 카드를 눌러야 오른쪽에 나오므로 목록은 "훑어보는
          용도"로만 좁게 유지. */}
      <div className="grid grid-cols-1 xl:grid-cols-[240px_1fr] gap-6">
        {/* 인시던트가 계속 쌓이면 이 리스트가 끝없이 늘어나서 페이지 전체가
            하염없이 길어지던 문제 - 높이를 고정하고 리스트 안에서만 스크롤되게
            바꿨다(InfrastructureView의 "클러스터 구조" 패널과 같은 패턴).
            pr-2로 스크롤바가 카드 텍스트를 가리지 않게 여백을 둔다. */}
        <div>
          {/* 2026-07-17: 같은 규칙으로 반복 발화하거나 비슷한 대역의 IP에서 온
              인시던트가 리스트를 도배하는 문제 - 토글로 켜면 하나로 묶어서
              "×N" 배지로 보여주고 눌러서 펼칠 수 있다. */}
          <div className="flex flex-col gap-1.5 mb-2">
            <button
              onClick={() => setGroupSimilar((v) => !v)}
              className={`flex items-center gap-1.5 text-[11px] font-medium px-2 py-1.5 rounded-lg border transition-colors text-left ${
                groupSimilar
                  ? "bg-dash-mint/15 text-dash-mint border-dash-mint/40"
                  : "bg-dash-bg text-dash-muted border-transparent hover:text-dash-fg hover:bg-dash-surfaceAlt"
              }`}
            >
              <Layers className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
              유사 항목 묶어보기 {groupSimilar ? "ON" : "OFF"}
            </button>
            {groupSimilar && (
              <select
                value={ipTolerance}
                onChange={(e) => setIpTolerance(Number(e.target.value))}
                className="text-[11px] bg-dash-bg text-dash-muted border border-dash-surfaceAlt rounded-lg px-2 py-1.5 cursor-pointer"
                title="같은 그룹으로 묶을 IP 오차범위 - 좁을수록(정확히 일치) 더 세밀하게 나뉘고, 넓을수록(같은 /16) 더 많이 묶인다"
              >
                <option value={32}>IP 정확히 일치</option>
                <option value={24}>같은 /24 대역 (오차 최소, 기본값)</option>
                <option value={16}>같은 /16 대역 (넓게 묶기)</option>
              </select>
            )}
          </div>

          <div ref={scrollBoxRef} className="space-y-2 max-h-[640px] overflow-y-auto pr-2">
            {status === "loading" && <p className="text-dash-muted text-xs">불러오는 중...</p>}
            {status === "ready" && filteredIncidents.length === 0 && (
              <p className="text-dash-muted text-xs">조건에 맞는 인시던트가 없습니다.</p>
            )}
            <div ref={rowsWrapperRef} className="space-y-2">
              {!groupSimilar &&
                severityGroups.map((group) => (
                  <div key={group.key}>
                    <p className="text-dash-faint text-[10px] uppercase tracking-wide px-1 pt-2 pb-1 first:pt-0">
                      {SEVERITY_META[group.key].label} · {group.items.length}
                    </p>
                    <div className="space-y-2">
                      {group.items.map((inc) => (
                        <IncidentCard
                          key={inc.id}
                          incident={inc}
                          active={inc.id === selectedId}
                          onClick={() => setSelectedId(inc.id)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              {groupSimilar &&
                incidentGroups.map((group) => (
                  <GroupedIncidentCard
                    key={group.key}
                    group={group}
                    expanded={expandedGroups.has(group.key)}
                    onToggleExpand={() => toggleGroupExpanded(group.key)}
                    selectedId={selectedId}
                    onSelectIncident={setSelectedId}
                  />
                ))}
            </div>
            {/* 스크롤 바닥 도달 감지용 sentinel + 아직 안 불러온 나머지 행만큼의
                빈 공간(스크롤바 thumb이 튀지 않게) - statusFilter로 좁혀 보고
                있을 때(filteredIncidents.length < incidents.length)는 남은
                분량을 정확히 추정할 수 없어 스페이서를 생략한다. */}
            {hasMore && statusFilter === "ALL" && !groupSimilar && (
              <div style={{ height: estimatedRemaining * avgRowHeight }} aria-hidden="true" />
            )}
            <div ref={bottomSentinelRef} className="h-px" />
            {loadingMore && <p className="text-dash-muted text-[11px] text-center py-1">더 불러오는 중...</p>}
          </div>
        </div>

        {selected ? (
          <div className="bg-dash-surface rounded-2xl p-6">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <SeverityBadge level={severityBadgeKey(selected.severity)} />
                  <h2 className="text-dash-fg text-lg font-semibold">{selected.title}</h2>
                </div>
                <p className="text-dash-muted text-xs">
                  {selected.id} · {selected.correlation_key_type}={selected.correlation_key_value} · 최초탐지{" "}
                  {new Date(selected.created_at).toLocaleString("ko-KR", { timeZone: DISPLAY_TIMEZONE })}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <button
                  onClick={() => exportAdapter && exportIncidentCSV(exportAdapter)}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-dash-surfaceAlt text-dash-muted hover:text-dash-fg whitespace-nowrap"
                  title="이 인시던트를 CSV로 내보내기"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
                  CSV 내보내기
                </button>
                <button
                  onClick={() => exportAdapter && exportIncidentPDF(exportAdapter)}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-dash-surfaceAlt text-dash-muted hover:text-dash-fg whitespace-nowrap"
                  title="이 인시던트를 PDF 리포트로 내보내기"
                >
                  <FileText className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
                  PDF 내보내기
                </button>
                {selected.status === "open" && (
                  <button
                    onClick={() => handleAdvanceStatus("investigating")}
                    className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-dash-mint/15 text-dash-mint whitespace-nowrap hover:bg-dash-mint/25"
                  >
                    <Search className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
                    조사 시작
                  </button>
                )}
                {selected.status === "investigating" && !showCategoryPicker && (
                  <button
                    onClick={() => setShowCategoryPicker(true)}
                    className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-dash-mint/15 text-dash-mint whitespace-nowrap hover:bg-dash-mint/25"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
                    조사완료 처리
                  </button>
                )}
                {selected.status === "investigating" && showCategoryPicker && (
                  <div className="flex items-center gap-1.5 flex-wrap bg-dash-bg rounded-lg px-2.5 py-1.5">
                    <span className="text-dash-faint text-[10px] whitespace-nowrap">조치 유형 선택</span>
                    {RESOLUTION_CATEGORIES.map((cat) => (
                      <button
                        key={cat.key}
                        disabled={resolving}
                        onClick={() => handleResolveWithCategory(cat.key)}
                        className="text-[11px] font-medium px-2 py-1 rounded-md bg-dash-mint/15 text-dash-mint whitespace-nowrap hover:bg-dash-mint/25 disabled:opacity-50"
                      >
                        {cat.label}
                      </button>
                    ))}
                    <button
                      disabled={resolving}
                      onClick={() => setShowCategoryPicker(false)}
                      className="text-[11px] text-dash-faint hover:text-dash-muted whitespace-nowrap disabled:opacity-50"
                    >
                      취소
                    </button>
                  </div>
                )}
                {selected.status === "closed" && (
                  <span className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-dash-mint/15 text-dash-mint whitespace-nowrap">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
                    조치 완료
                    {resolutionCategories[selected.id] ? ` · ${RESOLUTION_CATEGORY_LABEL[resolutionCategories[selected.id]]}` : ""}
                  </span>
                )}
                {isIpKeyType(selected.correlation_key_type) &&
                  (alreadyBanned ? (
                    <span className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-dash-critical/15 text-dash-critical whitespace-nowrap">
                      <Ban className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
                      IP 차단됨
                    </span>
                  ) : (
                    <button
                      onClick={handleBanSourceIp}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-dash-critical/15 text-dash-critical whitespace-nowrap hover:bg-dash-critical/25"
                    >
                      <Ban className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
                      소스 IP 차단
                    </button>
                  ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="bg-dash-bg rounded-xl p-3">
                <p className="text-dash-muted text-[11px] mb-1">상관 규칙</p>
                <p className="text-dash-fg text-xs">{selectedScenario?.name || "-"}</p>
              </div>
              <div className="bg-dash-bg rounded-xl p-3">
                <p className="text-dash-muted text-[11px] mb-1">MITRE 경로</p>
                <p className="text-dash-fg text-xs">
                  {selected.mitre_tactics?.length ? selected.mitre_tactics.join(" → ") : "-"}
                </p>
              </div>
              <div className="bg-dash-bg rounded-xl p-3">
                <p className="text-dash-muted text-[11px] mb-1">상관 키</p>
                <p className="text-dash-fg text-xs">
                  {selected.correlation_key_type} = {selected.correlation_key_value}
                </p>
              </div>
            </div>

            <div className="mb-4">
              <h3 className="text-dash-fg text-sm font-semibold mb-1">공격 스토리라인</h3>
              <p className="text-dash-muted text-xs">
                관련 로그(WAS / Falco / K8s Audit)를 시간순으로 묶어 하나의 사건으로 재구성 · 시간은 로그 원본 기준
              </p>
            </div>

            <div className="max-h-[640px] overflow-y-auto pr-2">
              {timelineStatus === "loading" && <p className="text-dash-muted text-xs">불러오는 중...</p>}
              {timelineStatus === "ready" && timeline.length === 0 && (
                <p className="text-dash-muted text-xs">이 인시던트에 연결된 로그가 없습니다.</p>
              )}
              {timeline.map((entry, i) => (
                <StorylineEntry
                  key={entry.event_id}
                  entry={exportAdapter.storyline[i]}
                  isLast={i === timeline.length - 1}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-dash-surface rounded-2xl p-10 text-center">
            <p className="text-dash-muted text-xs">{status === "loading" ? "불러오는 중..." : "인시던트를 선택하세요."}</p>
          </div>
        )}
      </div>
    </div>
  );
}
