import React, { useEffect, useMemo, useRef, useState } from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { SeverityBadge, SourceBadge, StatusDot } from "../components/badges";
import { CHART_COLORS, forTheme, DONUT_PALETTE, chartTooltipProps } from "../data/theme";
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
import { apiGet, apiPatch, apiPost, apiDelete, ApiError } from "../lib/authApi";
import { DISPLAY_TIMEZONE } from "../lib/timezone";

// incidents.severity(1~4, event.severity와 같은 실 스케일)를 badges.jsx의
// SEVERITY_META 키(CRITICAL/HIGH/MEDIUM/LOW)로 별칭 처리.
const SEVERITY_TO_BADGE_KEY = { 4: "CRITICAL", 3: "HIGH", 2: "MEDIUM", 1: "LOW" };
function severityBadgeKey(sev) {
  return SEVERITY_TO_BADGE_KEY[sev] || "LOW";
}

// CriticalToastStack의 "조사하기"로 넘어온 이벤트(App.jsx의 focusEvent)를
// correlation_key_type별로 이벤트의 해당 필드와 비교해서, 그 이벤트가 속했을
// 인시던트를 찾는다. 이벤트 자체엔 incident_id가 없어서(정규화 이벤트와
// 인시던트는 별개 테이블 - correlation-engine이 사후에 묶는다) 완전히 정확한
// 매칭은 아니고, "이 키 값으로 잡힌 인시던트 중 가장 최근 것"을 최선으로 추정한다
// - correlation_key_type 3종(source.ip/user.name/orchestrator.resource.name)은
// servers/correlation-engine/app/scenarios/*.yaml 기준. 매칭 실패 시 null 반환
// (호출부가 기존처럼 목록 맨 위 항목으로 폴백).
function matchesCorrelationKey(incident, event) {
  const key = incident.correlation_key_value;
  if (!key) return false;
  switch (incident.correlation_key_type) {
    case "source.ip":
      return event.sourceIp === key;
    case "user.name":
      return event.raw?.["user.name"] === key;
    case "orchestrator.resource.name":
      return event.pod === key;
    default:
      return false;
  }
}

// 후보를 이 정도로 좁혀서 GET /incidents/{id}/events를 병렬로 쏜다 - user.name
// 처럼 여러 인시던트가 같은 값을 공유하는 키(예: 시나리오 25개 중 20개가
// k8s_audit이고 다 같은 인증서로 실행돼서 user.name="system:admin"이 20건 넘게
// 몰려있음, 2026-07-16 실측)에선 correlation_key만으론 구분이 안 돼서 무한정
// 늘리면 API 호출도 늘어난다.
const MAX_MATCH_CANDIDATES = 8;

// correlation_key_value가 같은(=같은 시나리오 계열일 가능성이 있는) 인시던트
// 후보를 추린 뒤, 실제로 이 이벤트가 그 인시던트에 진짜 속했는지(=incident_events
// 조인 테이블에 event_id가 있는지) GET /incidents/{id}/events로 확인해서 정확히
// 매칭한다. correlation_key_value만으로 후보를 하나 찍으면(예전 방식) user.name처럼
// 여러 인시던트가 같은 값을 공유하는 키에서 사실상 "그냥 최신 인시던트" 수준으로
// 틀리기 쉬웠다(2026-07-16, 실측: 조사하기 클릭 시 엉뚱한 인시던트로 이동하는
// 빈도가 더 높았음).
async function findIncidentForEvent(incidents, event) {
  if (!event) return null;
  const candidates = incidents.filter((inc) => matchesCorrelationKey(inc, event)).slice(0, MAX_MATCH_CANDIDATES);
  if (!candidates.length) return null;

  const checks = await Promise.all(
    candidates.map(async (inc) => {
      try {
        const events = await apiGet(`/incidents/${inc.id}/events`);
        return events?.some((e) => e.event_id === event.id) ? inc : null;
      } catch {
        return null; // 개별 조회 실패는 그 후보만 탈락시키고 계속 진행
      }
    })
  );
  // candidates는 incidents 순서(최신 갱신순)를 그대로 유지하므로, 실제 매칭된
  // 것 중 배열에서 가장 앞(=가장 최근)에 있는 걸 채택.
  return checks.find((inc) => inc) || null;
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
    return REAL_SEVERITY_LEVELS.filter((l) => counts[l.severity]).map((l, i) => ({
      key: l.key,
      label: l.label,
      count: counts[l.severity],
      // Overview의 도넛들(SeverityDonutCompact 등)과 같은 톤 다운 순환 팔레트로
      // 통일 - severity 배지 등 다른 곳의 의미색(빨강=critical 등)과는 별개.
      color: forTheme(DONUT_PALETTE[i % DONUT_PALETTE.length], theme),
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
              <Tooltip {...chartTooltipProps(C)} />
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
        color: forTheme(DONUT_PALETTE[i % DONUT_PALETTE.length], theme),
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
              <Tooltip {...chartTooltipProps(C)} />
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
 * Incidents 뷰 — GET /incidents(useIncidentsSocket.js가 ?since= 폴링) + GET
 * /incidents/{id}/timeline 실데이터 연동. 상태(open/investigating/closed)는 실제 Postgres 상태 머신을
 * 그대로 반영하고(PATCH /incidents/{id}/status), "소스 IP 차단"은 POST
 * /banned-ips로 감사 트레일을 남긴다(실제 트래픽 차단은 아님).
 *
 * pushToast: App.jsx의 토스트 시스템(선택) — 없으면 조용히 동작.
 */
export default function IncidentsView({ pushToast, focusEvent, onFocusConsumed }) {
  const { incidents, status, error, reload } = useIncidents({ limit: 200 });
  const { scenarios } = useScenarios();
  const { bannedIps, status: bannedStatus, error: bannedError, reload: reloadBans } = useBannedIps();
  // Incidents는 로그보다 드물게 발생하므로 7일을 "최근"으로 본다(다른 뷰의
  // 24h 위주 range와 다름 - 원래 mock의 "최근 7일" 문구를 그대로 이어받음).
  const { items: topIps } = useTopIps({ lookbackMs: 7 * 24 * 60 * 60 * 1000, limit: 1 });

  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selectedId, setSelectedId] = useState(null);

  useIncidentsSocket(reload);

  // focusEvent(CriticalToastStack "조사하기"로 넘어온 이벤트) 처리. 신경 쓸 게
  // 세 가지다:
  //   1) 이미 Incidents를 보고 있는 상태(selectedId가 이미 있음)에서 또 다른
  //      토스트를 눌러도 반응해야 한다 - 예전엔 selectedId 있으면 그냥 skip이라
  //      "이미 열어놓고 눌렀더니 아무 반응 없음" 버그가 있었다. consumedFocusRef로
  //      "이 focusEvent를 이미 처리했는지"를 selectedId 유무와 무관하게 추적한다.
  //   2) 인시던트는 상관분석 결과라 방금 뜬 CRITICAL 이벤트가 실제 인시던트로
  //      반영되기까지 살짝 지연될 수 있고(예: S4는 60초 내 5건 threshold),
  //      드물게는 threshold 미달로 끝내 인시던트가 안 생기기도 한다. 그래서
  //      즉시 매칭 안 되면 0.5초 간격으로 목록을 강제 재조회하며 최대 2초까지
  //      재시도하고, 그래도 못 찾으면 최신 인시던트로 폴백한다.
  //   3) findIncidentForEvent가 이제 GET /incidents/{id}/events를 호출하는
  //      비동기 함수라(2026-07-16, correlation_key만으로는 부정확해서 - 아래
  //      matchesCorrelationKey 주석 참고) resolvePendingFocus도 비동기다.
  //      resolveTokenRef로 "이 실행이 아직 최신 요청인지"를 확인해서, 그 사이에
  //      새 focusEvent가 오거나 다른 경로로 이미 처리됐으면 뒤늦게 도착한 결과를
  //      버린다.
  const consumedFocusRef = useRef(null);
  const pendingFocusRef = useRef(null); // { event, deadline } | null
  const incidentsRef = useRef(incidents);
  incidentsRef.current = incidents;
  const resolveTokenRef = useRef(0);

  async function resolvePendingFocus() {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const list = incidentsRef.current;
    if (!list.length) return;

    const myToken = ++resolveTokenRef.current;
    const matched = await findIncidentForEvent(list, pending.event);
    if (pendingFocusRef.current !== pending || resolveTokenRef.current !== myToken) return;

    if (matched) {
      setSelectedId(matched.id);
    } else if (Date.now() >= pending.deadline) {
      setSelectedId(list[0].id);
    } else {
      return; // 아직 시간 남았고 매칭도 안 됨 - 다음 재시도(reload)를 기다림
    }
    pendingFocusRef.current = null;
    onFocusConsumed?.();
  }

  useEffect(() => {
    if (!focusEvent || focusEvent === consumedFocusRef.current) return;
    consumedFocusRef.current = focusEvent;
    pendingFocusRef.current = { event: focusEvent, deadline: Date.now() + 2000 };
    resolvePendingFocus();

    reload();
    const poll = setInterval(reload, 500);
    const timeout = setTimeout(() => {
      clearInterval(poll);
      resolvePendingFocus(); // 마지막 기회 - 그래도 없으면 최신으로 강제 폴백
    }, 2000);

    return () => {
      clearInterval(poll);
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusEvent]);

  // incidents 목록이 갱신될 때마다(위 폴링 포함, 또는 useIncidentsSocket의 기본
  // 5초 폴링) 두 가지 중 하나를 한다: 대기 중인 focusEvent가 있으면 재매칭 시도,
  // 없으면(focusEvent 없이 연 일반 진입) 기존처럼 맨 위(최신) 항목을 자동 선택.
  // 반드시 하나의 effect 안에서 처리한다 - 별개 effect 두 개로 나누면 같은
  // 커밋에서 둘 다 [incidents] 변화에 반응해 같이 실행되면서 경쟁이 날 수 있다
  // (실제 마운트 테스트로 재현했던 버그, 자세한 경위는 git log 참고).
  useEffect(() => {
    if (pendingFocusRef.current) {
      resolvePendingFocus();
      return;
    }
    if (!selectedId && incidents.length) {
      setSelectedId(incidents[0].id);
    }
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
        {/* 인시던트가 계속 쌓이면 이 리스트가 끝없이 늘어나서 페이지 전체가
            하염없이 길어지던 문제 - 높이를 고정하고 리스트 안에서만 스크롤되게
            바꿨다(InfrastructureView의 "클러스터 구조" 패널과 같은 패턴).
            pr-2로 스크롤바가 카드 텍스트를 가리지 않게 여백을 둔다. */}
        <div className="space-y-3 max-h-[640px] overflow-y-auto pr-2">
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
