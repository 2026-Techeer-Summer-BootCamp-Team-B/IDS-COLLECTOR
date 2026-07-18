import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { SeverityBadge, SourceBadge, SEVERITY_META } from "../components/badges";
import { CHART_COLORS, forTheme, DONUT_PALETTE, donutPalette } from "../data/theme";
import { useTheme } from "../hooks/useTheme";
import { exportIncidentCSV, exportIncidentPDF } from "../lib/exportIncident";
import { useIncidents } from "../hooks/useIncidents";
import { useIncidentsSocket } from "../hooks/useIncidentsSocket";
import { useIncidentTimeline } from "../hooks/useIncidentTimeline";
import { useScenarios } from "../hooks/useScenarios";
import { useBannedIps } from "../hooks/useBannedIps";
import { useTopIps } from "../hooks/useTopIps";
import { getModuleMeta } from "../data/moduleMeta";
import { getRealSeverityMeta } from "../data/realSeverity";
import { apiPatch, apiPost, ApiError } from "../lib/authApi";
import { DISPLAY_TIMEZONE } from "../lib/timezone";
import { groupSimilarIncidents } from "../lib/incidentGrouping";

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
function tooltipStyle(C) {
  // LogDashboard.jsx의 동일 함수와 같은 이유 - 순수 블랙 테마에서 border:none이면
  // 배경과 안 구분됨 (2026-07-16, 도넛 차트 호버 가시성 피드백).
  return { background: C.surfaceAlt, border: `1px solid ${C.faint}`, borderRadius: 8, color: C.fg, fontSize: 12 };
}

function MiniKpi({ label, value, sub, color, onClick, active = false }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`bg-dash-surface rounded-2xl p-4 flex-1 min-w-[160px] text-left transition-shadow ${
        onClick ? "cursor-pointer hover:bg-dash-surfaceAlt/60" : ""
      } ${active ? "glow-box-mint" : ""}`}
    >
      <p className="text-dash-muted text-xs mb-1.5">{label}</p>
      <p className="text-lg font-semibold truncate" style={{ color: color || C.fg }}>
        {value}
      </p>
      {sub && <p className="text-dash-muted text-[11px] mt-0.5">{sub}</p>}
    </Tag>
  );
}

// 상태(open/investigating/closed) 필터 버튼 4개. GET /incidents로 받은 목록
// 하나에서 전부 파생. Top 상관 규칙/Top 공격 IP는 클릭해도 필터링되지 않는
// 순수 정보 카드라 이 버튼 그리드와 섞으면 "이것도 눌리나?" 하는 오해를 주고
// 톤도 안 맞았다(2026-07-16) - TopSignalsCard로 완전히 분리했다.
function IncidentKpiRow({ incidents, statusFilter, onFilterChange }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const openCount = incidents.filter((i) => i.status === "open").length;
  const investigatingCount = incidents.filter((i) => i.status === "investigating").length;
  const closedCount = incidents.filter((i) => i.status === "closed").length;

  return (
    <div className="flex flex-wrap gap-4">
      <MiniKpi label="Total" value={incidents.length} onClick={() => onFilterChange("ALL")} active={statusFilter === "ALL"} />
      <MiniKpi
        label="Open"
        value={openCount}
        color={C.critical}
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

function SeverityDonut({ incidents }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const data = useMemo(() => {
    const counts = {};
    incidents.forEach((i) => {
      const key = severityBadgeKey(i.severity);
      counts[key] = (counts[key] || 0) + 1;
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
  }, [incidents, theme]);
  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <div className="bg-dash-surface rounded-2xl p-5">
      <h3 className="text-dash-fg text-sm font-semibold mb-1">심각도 분포</h3>
      <p className="text-dash-muted text-xs mb-3">전체 인시던트 · 총 {total}건</p>
      {total === 0 ? (
        <p className="text-dash-muted text-xs">인시던트가 없습니다.</p>
      ) : (
        <div className="flex items-center gap-4">
          <ResponsiveContainer width={130} height={130}>
            <PieChart>
              <Pie data={data} dataKey="count" nameKey="label" innerRadius={38} outerRadius={62} stroke="none">
                {data.map((d) => (
                  <Cell key={d.key} fill={d.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle(C)} cursor={false} isAnimationActive={false} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 space-y-1.5 text-xs">
            {data.map((d) => (
              <div key={d.key} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-dash-muted truncate">
                  <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ backgroundColor: d.color }} />
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

function StatusDonut({ incidents }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const data = useMemo(() => {
    const counts = {};
    incidents.forEach((i) => {
      counts[i.status] = (counts[i.status] || 0) + 1;
    });
    return Object.entries(STATUS_META)
      .filter(([key]) => counts[key])
      .map(([key, meta], i) => ({
        key,
        label: meta.label,
        count: counts[key],
        color: donutPalette(theme)[i % DONUT_PALETTE.length],
      }));
  }, [incidents, theme]);
  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <div className="bg-dash-surface rounded-2xl p-5">
      <h3 className="text-dash-fg text-sm font-semibold mb-1">상태별 분포</h3>
      <p className="text-dash-muted text-xs mb-3">Open / Investigating / Closed · 총 {total}건</p>
      {total === 0 ? (
        <p className="text-dash-muted text-xs">인시던트가 없습니다.</p>
      ) : (
        <div className="flex items-center gap-4">
          <ResponsiveContainer width={130} height={130}>
            <PieChart>
              <Pie data={data} dataKey="count" nameKey="label" innerRadius={38} outerRadius={62} stroke="none">
                {data.map((d) => (
                  <Cell key={d.key} fill={d.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle(C)} cursor={false} isAnimationActive={false} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 space-y-1.5 text-xs">
            {data.map((d) => (
              <div key={d.key} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-dash-muted truncate">
                  <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ backgroundColor: d.color }} />
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
  const data = useMemo(
    () =>
      [...scenarios]
        .filter((s) => s.hit_count > 0)
        .sort((a, b) => b.hit_count - a.hit_count)
        .slice(0, 5)
        .map((s) => ({ id: s.id, name: s.name, hits: s.hit_count })),
    [scenarios]
  );

  return (
    <div className="bg-dash-surface rounded-2xl p-5">
      <h3 className="text-dash-fg text-sm font-semibold mb-1">공격 유형별 적중 통계 TOP 5</h3>
      <p className="text-dash-muted text-xs mb-3">
        어떤 상관 규칙(공격 패턴)이 인시던트를 가장 많이 만들었는지 · GET /scenarios 기준
      </p>
      {/* 2026-07-16(8차): "높이를 조금 줄여도 될 거 같다"는 피드백 - 행당
          높이를 44 -> 36, 최소 높이를 180 -> 160으로 줄였다. */}
      {data.length === 0 ? (
        <p className="text-dash-muted text-xs py-3">적중된 상관 규칙이 없습니다.</p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(160, data.length * 36)}>
          <BarChart data={data} layout="vertical" margin={{ left: 4, right: 28, top: 4, bottom: 4 }}>
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
              contentStyle={tooltipStyle(C)}
              cursor={{ fill: C.surfaceAlt, opacity: 0.5 }}
              formatter={(value) => [`${value}건`, "적중 건수"]}
              labelFormatter={(label, payload) => payload?.[0]?.payload?.name ?? label}
              isAnimationActive={false}
            />
            <Bar dataKey="hits" radius={[0, 6, 6, 0]} isAnimationActive animationDuration={700} animationEasing="ease-out">
              {data.map((d, i) => (
                <Cell key={d.id} fill={donutPalette(theme)[i % DONUT_PALETTE.length]} />
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
              <span className="ml-0.5">{expanded ? "▲" : "▼"}</span>
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
  const { incidents, status, error, reload } = useIncidents({ limit: 200 });
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

  function toggleGroupExpanded(key) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  useIncidentsSocket(reload);

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

  const filteredIncidents = useMemo(
    () => (statusFilter === "ALL" ? incidents : incidents.filter((i) => i.status === statusFilter)),
    [incidents, statusFilter]
  );

  const incidentGroups = useMemo(
    () => (groupSimilar ? groupSimilarIncidents(filteredIncidents, ipTolerance) : null),
    [groupSimilar, filteredIncidents, ipTolerance]
  );

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
      sourceIp: selected.correlation_key_type === "source_ip" ? selected.correlation_key_value : "-",
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
        <h2 className="text-dash-fg text-base font-semibold mb-1">인시던트</h2>
        <p className="text-dash-muted text-xs">
          여러 로그(WAS / Falco / K8s Audit)가 상관 규칙에 의해 하나의 사건으로 묶인 인시던트 목록입니다
        </p>
      </div>

      {status === "error" && <p className="text-dash-critical text-xs">{error}</p>}

      <IncidentKpiRow incidents={incidents} statusFilter={statusFilter} onFilterChange={setStatusFilter} />

      <TopSignalsCard topScenario={topScenario} topIp={topIps[0]} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SeverityDonut incidents={incidents} />
        <StatusDonut incidents={incidents} />
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
              className={`text-[11px] font-medium px-2 py-1.5 rounded-lg border transition-colors text-left ${
                groupSimilar
                  ? "bg-dash-mint/15 text-dash-mint border-dash-mint/40"
                  : "bg-dash-bg text-dash-muted border-transparent hover:text-dash-fg hover:bg-dash-surfaceAlt"
              }`}
            >
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

          <div className="space-y-2 max-h-[640px] overflow-y-auto pr-2">
            {status === "loading" && <p className="text-dash-muted text-xs">불러오는 중...</p>}
            {status === "ready" && filteredIncidents.length === 0 && (
              <p className="text-dash-muted text-xs">조건에 맞는 인시던트가 없습니다.</p>
            )}
            {!groupSimilar &&
              filteredIncidents.map((inc) => (
                <IncidentCard key={inc.id} incident={inc} active={inc.id === selectedId} onClick={() => setSelectedId(inc.id)} />
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
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-dash-surfaceAlt text-dash-muted hover:text-dash-fg whitespace-nowrap"
                  title="이 인시던트를 CSV로 내보내기"
                >
                  CSV 내보내기
                </button>
                <button
                  onClick={() => exportAdapter && exportIncidentPDF(exportAdapter)}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-dash-surfaceAlt text-dash-muted hover:text-dash-fg whitespace-nowrap"
                  title="이 인시던트를 PDF 리포트로 내보내기"
                >
                  PDF 내보내기
                </button>
                {selected.status === "open" && (
                  <button
                    onClick={() => handleAdvanceStatus("investigating")}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-dash-mint/15 text-dash-mint whitespace-nowrap hover:bg-dash-mint/25"
                  >
                    조사 시작
                  </button>
                )}
                {selected.status === "investigating" && (
                  <button
                    onClick={() => handleAdvanceStatus("closed")}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-dash-mint/15 text-dash-mint whitespace-nowrap hover:bg-dash-mint/25"
                  >
                    조사완료 처리
                  </button>
                )}
                {selected.status === "closed" && (
                  <span className="text-xs font-medium px-3 py-1.5 rounded-lg bg-dash-mint/15 text-dash-mint whitespace-nowrap">
                    조치 완료
                  </span>
                )}
                {selected.correlation_key_type === "source_ip" &&
                  (alreadyBanned ? (
                    <span className="text-xs font-medium px-3 py-1.5 rounded-lg bg-dash-critical/15 text-dash-critical whitespace-nowrap">
                      IP 차단됨
                    </span>
                  ) : (
                    <button
                      onClick={handleBanSourceIp}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg bg-dash-critical/15 text-dash-critical whitespace-nowrap hover:bg-dash-critical/25"
                    >
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
