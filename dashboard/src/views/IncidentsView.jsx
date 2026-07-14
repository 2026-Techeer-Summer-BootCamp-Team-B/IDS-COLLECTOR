import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { SeverityBadge, SourceBadge, StatusDot } from "../components/badges";
import { CHART_COLORS, forTheme } from "../data/theme";
import { useTheme } from "../hooks/useTheme";
import { exportIncidentCSV, exportIncidentPDF } from "../lib/exportIncident";
import { useIncidents } from "../hooks/useIncidents";
import { useIncidentsSocket } from "../hooks/useIncidentsSocket";
import { useIncidentTimeline } from "../hooks/useIncidentTimeline";
import { useScenarios } from "../hooks/useScenarios";
import { useBannedIps } from "../hooks/useBannedIps";
import { useTopIps } from "../hooks/useTopIps";
import { getModuleMeta } from "../data/moduleMeta";
import { REAL_SEVERITY_LEVELS, getRealSeverityMeta } from "../data/realSeverity";
import { apiPatch, apiPost, apiDelete, ApiError } from "../lib/authApi";
import { DISPLAY_TIMEZONE } from "../lib/timezone";

// incidents.severity(1~4, event.severity와 같은 실 스케일)를 badges.jsx의
// SEVERITY_META 키(CRITICAL/HIGH/MEDIUM/LOW)로 별칭 처리.
const SEVERITY_TO_BADGE_KEY = { 4: "CRITICAL", 3: "HIGH", 2: "MEDIUM", 1: "LOW" };
function severityBadgeKey(sev) {
  return SEVERITY_TO_BADGE_KEY[sev] || "LOW";
}

const STATUS_LABEL = { open: "Open", investigating: "조사중", closed: "종결" };
const STATUS_META = {
  open: { label: "Open", color: "#FF1F4B" },
  investigating: { label: "Investigating", color: "#F5E400" },
  closed: { label: "Closed", color: "#00FFA6" },
};
// StatusDot은 IN_PROGRESS/그 외 두 상태만 구분(진행중/조사완료) — open과
// investigating을 모두 "진행중"으로 묶는다.
function statusDotStatus(status) {
  return status === "closed" ? "RESOLVED" : "IN_PROGRESS";
}

function tooltipStyle(C) {
  return { background: C.surfaceAlt, border: "none", borderRadius: 8, color: C.fg, fontSize: 12 };
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

// 상태(open/investigating/closed) 필터 버튼 4개 + Top 상관 규칙/Top 공격 IP
// 정보성 카드 2개. GET /incidents로 받은 목록 하나에서 전부 파생.
function IncidentKpiRow({ incidents, statusFilter, onFilterChange, topScenario, topIp }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const openCount = incidents.filter((i) => i.status === "open").length;
  const investigatingCount = incidents.filter((i) => i.status === "investigating").length;
  const closedCount = incidents.filter((i) => i.status === "closed").length;

  return (
    <div className="flex flex-wrap gap-4">
      <MiniKpi label="전체 인시던트" value={incidents.length} onClick={() => onFilterChange("ALL")} active={statusFilter === "ALL"} />
      <MiniKpi
        label="Open"
        value={openCount}
        color={C.critical}
        onClick={() => onFilterChange("open")}
        active={statusFilter === "open"}
      />
      <MiniKpi
        label="조사중"
        value={investigatingCount}
        onClick={() => onFilterChange("investigating")}
        active={statusFilter === "investigating"}
      />
      <MiniKpi
        label="종결"
        value={closedCount}
        color={C.mint}
        onClick={() => onFilterChange("closed")}
        active={statusFilter === "closed"}
      />
      <MiniKpi
        label="Top 상관 규칙"
        value={topScenario?.name || "-"}
        sub={topScenario ? `${topScenario.hit_count}건 적중` : ""}
        color={C.pink}
      />
      <MiniKpi label="Top 공격 IP" value={topIp?.name || "-"} sub={topIp ? `${topIp.count}건` : ""} color={C.critical} />
    </div>
  );
}

function SeverityDonut({ incidents }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const data = useMemo(() => {
    const counts = {};
    incidents.forEach((i) => {
      counts[i.severity] = (counts[i.severity] || 0) + 1;
    });
    return REAL_SEVERITY_LEVELS.filter((l) => counts[l.severity]).map((l) => ({
      key: l.key,
      label: l.label,
      count: counts[l.severity],
      color: forTheme(l.color, theme),
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
              <Tooltip contentStyle={tooltipStyle(C)} />
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
      .map(([key, meta]) => ({ key, label: meta.label, count: counts[key], color: forTheme(meta.color, theme) }));
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
              <Tooltip contentStyle={tooltipStyle(C)} />
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

// 차단 기록(감사 트레일용, 실제 트래픽은 안 막힘 - banned_ips_api.py 주석 참고)
// 테이블. 수동으로 IP를 추가/해제할 수 있다.
function BannedIpsTable({ bannedIps, status, error, onBan, onUnban }) {
  const [ip, setIp] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!ip.trim()) return;
    setSubmitting(true);
    try {
      await onBan(ip.trim(), reason.trim() || undefined);
      setIp("");
      setReason("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-dash-surface rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="text-dash-fg text-sm font-semibold">차단된 IP</h3>
          <p className="text-dash-muted text-xs mt-0.5">GET /banned-ips · 감사 트레일 (실제 트래픽 차단은 아님)</p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-wrap gap-1.5">
          <input
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            placeholder="IP / CIDR"
            className="bg-dash-bg text-sm text-dash-fg placeholder-dash-muted rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-dash-mint w-36"
          />
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="사유 (선택)"
            className="bg-dash-bg text-sm text-dash-fg placeholder-dash-muted rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-dash-mint w-36"
          />
          <button
            type="submit"
            disabled={submitting || !ip.trim()}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-dash-critical/15 text-dash-critical hover:bg-dash-critical/25 disabled:opacity-50 whitespace-nowrap"
          >
            차단
          </button>
        </form>
      </div>
      {status === "loading" && <p className="text-dash-muted text-xs py-3">불러오는 중...</p>}
      {status === "error" && <p className="text-dash-critical text-xs py-3">{error}</p>}
      {status === "ready" && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-dash-muted text-xs uppercase tracking-wide">
                <th className="text-left font-medium pb-2">IP / CIDR</th>
                <th className="text-left font-medium pb-2">사유</th>
                <th className="text-left font-medium pb-2">차단 시각</th>
                <th className="text-left font-medium pb-2">조치</th>
              </tr>
            </thead>
            <tbody>
              {bannedIps.map((b) => (
                <tr key={b.id} className="border-t border-dash-surfaceAlt">
                  <td className="py-2.5 pr-3 text-dash-fg font-mono">{b.ip_or_cidr}</td>
                  <td className="py-2.5 pr-3 text-dash-muted text-xs">{b.reason || "-"}</td>
                  <td className="py-2.5 pr-3 text-dash-faint text-xs whitespace-nowrap">
                    {new Date(b.created_at).toLocaleString("ko-KR", { timeZone: DISPLAY_TIMEZONE })}
                  </td>
                  <td className="py-2.5">
                    <button
                      onClick={() => onUnban(b.id)}
                      className="text-[10px] px-2 py-1 rounded bg-dash-surfaceAlt text-dash-muted hover:text-dash-fg whitespace-nowrap"
                    >
                      해제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {bannedIps.length === 0 && <p className="text-dash-muted text-xs py-3">현재 차단된 IP가 없습니다.</p>}
        </div>
      )}
    </div>
  );
}

function IncidentCard({ incident, active, onClick }) {
  const { theme } = useTheme();
  const meta = getRealSeverityMeta(incident.severity);
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
          <SeverityBadge level={severityBadgeKey(incident.severity)} />
          <span className="text-dash-faint text-xs">{STATUS_LABEL[incident.status]}</span>
        </div>
        <StatusDot status={statusDotStatus(incident.status)} />
      </div>
      <p className="text-dash-fg text-sm font-medium mb-1.5">{incident.title}</p>
      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
        {incident.mitre_tactics.slice(0, 3).map((t) => (
          <SourceBadge key={t} source={t} />
        ))}
      </div>
      <p className="text-dash-muted text-xs">
        {incident.correlation_key_type}={incident.correlation_key_value} · {new Date(incident.updated_at).toLocaleString("ko-KR", { timeZone: DISPLAY_TIMEZONE })}
      </p>
    </button>
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
 * Incidents 뷰 — GET /incidents + GET /incidents/{id}/timeline + /ws/incidents
 * 실데이터 연동. 상태(open/investigating/closed)는 실제 Postgres 상태 머신을
 * 그대로 반영하고(PATCH /incidents/{id}/status), "소스 IP 차단"은 POST
 * /banned-ips로 감사 트레일을 남긴다(실제 트래픽 차단은 아님).
 *
 * pushToast: App.jsx의 토스트 시스템(선택) — 없으면 조용히 동작.
 */
export default function IncidentsView({ pushToast }) {
  const { incidents, status, error, reload } = useIncidents({ limit: 200 });
  const { scenarios } = useScenarios();
  const { bannedIps, status: bannedStatus, error: bannedError, reload: reloadBans } = useBannedIps();
  // Incidents는 로그보다 드물게 발생하므로 7일을 "최근"으로 본다(다른 뷰의
  // 24h 위주 range와 다름 - 원래 mock의 "최근 7일" 문구를 그대로 이어받음).
  const { items: topIps } = useTopIps({ lookbackMs: 7 * 24 * 60 * 60 * 1000, limit: 1 });

  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selectedId, setSelectedId] = useState(null);

  useIncidentsSocket(reload);

  useEffect(() => {
    if (!selectedId && incidents.length) setSelectedId(incidents[0].id);
  }, [incidents, selectedId]);

  const filteredIncidents = useMemo(
    () => (statusFilter === "ALL" ? incidents : incidents.filter((i) => i.status === statusFilter)),
    [incidents, statusFilter]
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

  async function handleManualBan(ip, reason) {
    try {
      await apiPost("/banned-ips", { ip_or_cidr: ip, reason });
      toast(`${ip} 차단 처리했습니다.`, "success");
      reloadBans();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "IP 차단에 실패했습니다.", "error");
    }
  }

  async function handleUnban(bannedIpId) {
    try {
      await apiDelete(`/banned-ips/${bannedIpId}`);
      toast("차단을 해제했습니다.", "success");
      reloadBans();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "차단 해제에 실패했습니다.", "error");
    }
  }

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
      {status === "error" && <p className="text-dash-critical text-xs">{error}</p>}

      <IncidentKpiRow
        incidents={incidents}
        statusFilter={statusFilter}
        onFilterChange={setStatusFilter}
        topScenario={topScenario}
        topIp={topIps[0]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SeverityDonut incidents={incidents} />
        <StatusDonut incidents={incidents} />
      </div>

      <BannedIpsTable
        bannedIps={bannedIps}
        status={bannedStatus}
        error={bannedError}
        onBan={handleManualBan}
        onUnban={handleUnban}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-6">
        <div className="space-y-3">
          {status === "loading" && <p className="text-dash-muted text-xs">불러오는 중...</p>}
          {status === "ready" && filteredIncidents.length === 0 && (
            <p className="text-dash-muted text-xs">조건에 맞는 인시던트가 없습니다.</p>
          )}
          {filteredIncidents.map((inc) => (
            <IncidentCard key={inc.id} incident={inc} active={inc.id === selectedId} onClick={() => setSelectedId(inc.id)} />
          ))}
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

            <div>
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
