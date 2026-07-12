import React, { useMemo, useState } from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { incidents } from "../data/incidents";
import { SeverityBadge, SourceBadge, StatusDot, SEVERITY_META, SOURCE_META } from "../components/badges";
import { ATTACK_EVENTS, ATTACK_TYPES, byAttackType, bySource, byIp } from "../data/attackEvents";
import { MOCK_NOW } from "../data/mockLogs";
import { CHART_COLORS, forTheme } from "../data/theme";
import { useTheme } from "../hooks/useTheme";
import { exportIncidentCSV, exportIncidentPDF } from "../lib/exportIncident";

function tooltipStyle(C) {
  return { background: C.surfaceAlt, border: "none", borderRadius: 8, color: C.fg, fontSize: 12 };
}

function MiniKpi({ label, value, sub, color }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  return (
    <div className="bg-dash-surface rounded-2xl p-4 flex-1 min-w-[160px]">
      <p className="text-dash-muted text-xs mb-1.5">{label}</p>
      <p className="text-lg font-semibold truncate" style={{ color: color || C.fg }}>
        {value}
      </p>
      {sub && <p className="text-dash-muted text-[11px] mt-0.5">{sub}</p>}
    </div>
  );
}

// 오늘(최근 24h) 기준 탐지/차단 수 + Top 공격유형 / Top 공격 IP.
function KpiRow() {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const last24h = useMemo(() => {
    const cutoff = MOCK_NOW.getTime() - 24 * 60 * 60 * 1000;
    return ATTACK_EVENTS.filter((e) => e.timestamp.getTime() > cutoff);
  }, []);
  const blockedCount = last24h.filter((e) => e.blocked).length;
  const topType = byAttackType(last24h).find((t) => t.count > 0);
  const topIp = byIp(last24h)[0];

  return (
    <div className="flex flex-wrap gap-4">
      <MiniKpi label="오늘 탐지 수" value={last24h.length} />
      <MiniKpi label="오늘 차단 수" value={blockedCount} color={C.mint} />
      <MiniKpi
        label="Top 공격유형"
        value={topType?.label || "-"}
        sub={topType ? `${topType.count}건` : ""}
        color={forTheme(topType?.color, theme)}
      />
      <MiniKpi label="Top 공격 IP" value={topIp?.ip || "-"} sub={topIp ? `${topIp.count}건` : ""} color={C.critical} />
    </div>
  );
}

// "누가/무엇을 잡았는지" 요약 — 개별 인시던트(상관분석 결과)와는 다른 층위로,
// ATTACK_EVENTS(개별 탐지/차단 이벤트) 전체를 집계한 스냅샷.
function AttackTypeDonut() {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const data = useMemo(
    () => byAttackType(ATTACK_EVENTS).filter((d) => d.count > 0).map((d) => ({ ...d, color: forTheme(d.color, theme) })),
    [theme]
  );
  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <div className="bg-dash-surface rounded-2xl p-5">
      <h3 className="text-dash-fg text-sm font-semibold mb-1">공격 유형 분포</h3>
      <p className="text-dash-muted text-xs mb-3">최근 7일 · 총 {total}건</p>
      <div className="flex items-center gap-4">
        <ResponsiveContainer width={130} height={130}>
          <PieChart>
            <Pie data={data} dataKey="count" nameKey="label" innerRadius={38} outerRadius={62} stroke="none">
              {data.map((d) => (
                <Cell key={d.key} fill={d.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle(C)} />
          </PieChart>
        </ResponsiveContainer>
        <div className="flex-1 space-y-1.5 text-xs">
          {data.slice(0, 6).map((d) => (
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
    </div>
  );
}

// "누가 잡았는지" — detection_source(WAS/Falco/K8s Audit)별 기여도.
function SourceDonut() {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const data = useMemo(
    () =>
      bySource(ATTACK_EVENTS).map((d) => {
        const meta = SOURCE_META[d.source] || { label: d.source, color: "#87888C" };
        return { ...d, ...meta, color: forTheme(meta.color, theme) };
      }),
    [theme]
  );
  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <div className="bg-dash-surface rounded-2xl p-5">
      <h3 className="text-dash-fg text-sm font-semibold mb-1">탐지 소스별 분포</h3>
      <p className="text-dash-muted text-xs mb-3">누가 잡았는지 · 총 {total}건</p>
      <div className="flex items-center gap-4">
        <ResponsiveContainer width={130} height={130}>
          <PieChart>
            <Pie data={data} dataKey="count" nameKey="label" innerRadius={38} outerRadius={62} stroke="none">
              {data.map((d) => (
                <Cell key={d.source} fill={d.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle(C)} />
          </PieChart>
        </ResponsiveContainer>
        <div className="flex-1 space-y-1.5 text-xs">
          {data.map((d) => (
            <div key={d.source} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-dash-muted truncate">
                <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ backgroundColor: d.color }} />
                {d.label}
              </span>
              <span className="text-dash-fg">{d.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// 최근 탐지/차단 로그 8건을 테이블로 보여주고, 검색/차단 버튼 제공.
function BlockedLogsTable({ actedEventIds = {}, onActOnEvent }) {
  const { theme } = useTheme();
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ATTACK_EVENTS.filter(
      (e) =>
        q === "" ||
        e.message.toLowerCase().includes(q) ||
        e.pod.toLowerCase().includes(q) ||
        e.country.toLowerCase().includes(q)
    );
  }, [query]);

  return (
    <div className="bg-dash-surface rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="text-dash-fg text-sm font-semibold">최근 차단/탐지 로그</h3>
          <p className="text-dash-muted text-xs mt-0.5">
            Showing {Math.min(filtered.length, 8)} of {filtered.length}
          </p>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="검색 (메시지/Pod/국가)..."
          className="bg-dash-bg text-sm text-dash-fg placeholder-dash-muted rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-dash-mint w-52"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-dash-muted text-xs uppercase tracking-wide">
              <th className="text-left font-medium pb-2">Time</th>
              <th className="text-left font-medium pb-2">공격 유형</th>
              <th className="text-left font-medium pb-2">심각도</th>
              <th className="text-left font-medium pb-2">소스</th>
              <th className="text-left font-medium pb-2">대상</th>
              <th className="text-left font-medium pb-2">출발지</th>
              <th className="text-left font-medium pb-2">조치</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 8).map((e) => {
              const type = ATTACK_TYPES.find((t) => t.key === e.attackType);
              const typeColor = forTheme(type.color, theme);
              const manuallyActed = !!actedEventIds[e.id];
              const effectiveBlocked = e.blocked || manuallyActed;
              const label = manuallyActed && !e.blocked ? "조치 완료" : e.action;
              return (
                <tr key={e.id} className="border-t border-dash-surfaceAlt">
                  <td className="py-2.5 text-dash-faint whitespace-nowrap pr-3">
                    {e.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="py-2.5 pr-3">
                    <span
                      className="text-xs font-medium px-2 py-1 rounded-md whitespace-nowrap"
                      style={{ color: typeColor, backgroundColor: `${typeColor}22` }}
                    >
                      {type.label}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3">
                    <SeverityBadge level={e.severity} />
                  </td>
                  <td className="py-2.5 pr-3">
                    <SourceBadge source={e.source} />
                  </td>
                  <td className="py-2.5 pr-3 text-dash-fg whitespace-nowrap text-xs">
                    {e.namespace}/{e.pod}
                  </td>
                  <td className="py-2.5 pr-3 text-dash-faint text-xs whitespace-nowrap">
                    {e.sourceIp} ({e.country})
                  </td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`text-[10px] px-2 py-1 rounded-md whitespace-nowrap ${
                          effectiveBlocked ? "bg-dash-mint/15 text-dash-mint" : "bg-dash-pink/15 text-dash-pink"
                        }`}
                      >
                        {label}
                      </span>
                      {!effectiveBlocked && (
                        <button
                          onClick={() => onActOnEvent?.(e)}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-dash-critical/15 text-dash-critical hover:bg-dash-critical/25 whitespace-nowrap"
                        >
                          차단
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="text-dash-muted text-xs py-3">조건에 맞는 로그가 없습니다.</p>}
      </div>
    </div>
  );
}

function IncidentCard({ incident, active, onClick }) {
  const { theme } = useTheme();
  const meta = SEVERITY_META[incident.severity];
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-xl p-3 border-l-4 transition-colors ${
        active ? "bg-dash-surfaceAlt" : "bg-dash-surface hover:bg-dash-surfaceAlt/60"
      }`}
      style={{ borderLeftColor: forTheme(meta.color, theme) }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <SeverityBadge level={incident.severity} />
          <span className="text-dash-faint text-xs">{incident.id}</span>
        </div>
        <StatusDot status={incident.status} />
      </div>
      <p className="text-dash-fg text-sm font-medium mb-1.5">{incident.title}</p>
      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
        {incident.sources.map((s) => (
          <SourceBadge key={s} source={s} />
        ))}
      </div>
      <p className="text-dash-muted text-xs">
        {incident.logCount} logs · {incident.firstDetected}
      </p>
    </button>
  );
}

function StorylineEntry({ entry, isLast }) {
  const lines = entry.detail.split("\n");
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

export default function IncidentsView({
  resolvedIncidentIds = {},
  onResolveIncident,
  actedEventIds = {},
  onActOnEvent,
}) {
  const [selectedId, setSelectedId] = useState(incidents[0].id);
  const selected = incidents.find((i) => i.id === selectedId) || incidents[0];
  const selectedResolved = !!resolvedIncidentIds[selected.id];

  return (
    <div className="space-y-6">
      <KpiRow />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AttackTypeDonut />
        <SourceDonut />
      </div>

      <BlockedLogsTable actedEventIds={actedEventIds} onActOnEvent={onActOnEvent} />

      <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-6">
        <div className="space-y-3">
          {incidents.map((inc) => {
            const effective = resolvedIncidentIds[inc.id] ? { ...inc, status: "RESOLVED" } : inc;
            return (
              <IncidentCard
                key={inc.id}
                incident={effective}
                active={inc.id === selectedId}
                onClick={() => setSelectedId(inc.id)}
              />
            );
          })}
        </div>

        <div className="bg-dash-surface rounded-2xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <SeverityBadge level={selected.severity} />
              <h2 className="text-dash-fg text-lg font-semibold">{selected.title}</h2>
            </div>
            <p className="text-dash-muted text-xs">
              {selected.id} · 대상 {selected.target} · 출발 {selected.sourceIp} ({selected.sourceCountry}) · 최초탐지{" "}
              {selected.firstDetected}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => exportIncidentCSV(selected)}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-dash-surfaceAlt text-dash-muted hover:text-dash-fg whitespace-nowrap"
              title="이 인시던트를 CSV로 내보내기"
            >
              CSV 내보내기
            </button>
            <button
              onClick={() => exportIncidentPDF(selected)}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-dash-surfaceAlt text-dash-muted hover:text-dash-fg whitespace-nowrap"
              title="이 인시던트를 PDF 리포트로 내보내기"
            >
              PDF 내보내기
            </button>
            {selectedResolved ? (
              <span className="text-xs font-medium px-3 py-1.5 rounded-lg bg-dash-mint/15 text-dash-mint whitespace-nowrap">
                조치 완료
              </span>
            ) : (
              <button
                onClick={() => onResolveIncident?.(selected)}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-dash-mint/15 text-dash-mint whitespace-nowrap hover:bg-dash-mint/25"
              >
                조사완료 · 소스 IP 차단
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-dash-bg rounded-xl p-3">
            <p className="text-dash-muted text-[11px] mb-1">상관 규칙</p>
            <p className="text-dash-fg text-xs">{selected.correlationRule}</p>
          </div>
          <div className="bg-dash-bg rounded-xl p-3">
            <p className="text-dash-muted text-[11px] mb-1">MITRE 경로</p>
            <p className="text-dash-fg text-xs">{selected.mitrePath.join(" → ")}</p>
          </div>
          <div className="bg-dash-bg rounded-xl p-3">
            <p className="text-dash-muted text-[11px] mb-1">위험 신호</p>
            <p className="text-dash-fg text-xs">{selected.riskNote}</p>
          </div>
        </div>

        <div className="mb-4">
          <h3 className="text-dash-fg text-sm font-semibold mb-1">공격 스토리라인</h3>
          <p className="text-dash-muted text-xs">
            관련 로그(WAS / Falco / K8s Audit)를 시간순으로 묶어 하나의 사건으로 재구성 · 시간은 로그 원본 기준
          </p>
        </div>

        <div>
          {selected.storyline.map((entry, i) => (
            <StorylineEntry key={i} entry={entry} isLast={i === selected.storyline.length - 1} />
          ))}
        </div>
        </div>
      </div>
    </div>
  );
}
