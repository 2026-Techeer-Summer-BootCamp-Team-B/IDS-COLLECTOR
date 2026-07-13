import React, { useMemo, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { K8S_AUDIT_EVENTS, byVerb, byResource, byUser } from "../data/k8sAuditLogs";
import { MOCK_NOW } from "../data/mockLogs";
import { RANGE_PRESETS, bucketEvents } from "../data/timeSeries";
import { CHART_COLORS } from "../data/theme";
import { useTheme } from "../hooks/useTheme";
import TimeRangePicker from "../components/TimeRangePicker";
import RankedList from "../components/RankedList";
import { Card, KpiCard, ErrorRateGauge } from "./LogDashboard";

// allowed -> INFO / denied -> CRITICAL 로 별칭을 붙여 기존 9단계 심각도 스케일을
// 쓰는 컴포넌트(ErrorRateGauge, bucketEvents)를 그대로 재사용한다. "거부된 요청"이
// 곧 이 페이지에서 가장 주목해야 할 신호라는 점에서 CRITICAL 매핑이 자연스럽다.
function withLevelAlias(events) {
  return events.map((e) => ({ ...e, level: e.allowed ? "INFO" : "CRITICAL" }));
}

function AuditRateChart({ events, rangeKey }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const preset = RANGE_PRESETS.find((p) => p.key === rangeKey);
  const data = useMemo(() => {
    const buckets = bucketEvents(withLevelAlias(events), preset, MOCK_NOW.getTime());
    return buckets.map((b) => ({
      label: b.label,
      total: Object.values(b.counts).reduce((a, c) => a + c, 0),
      denied: b.counts.CRITICAL || 0,
    }));
  }, [events, rangeKey]);

  return (
    <Card title="Audit Events Over Time" subtitle={`Last ${preset.label} · ${data.length} buckets`} className="h-72">
      <ResponsiveContainer width="100%" height="85%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="auditFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.was} stopOpacity={0.45} />
              <stop offset="100%" stopColor={C.was} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="auditDeniedFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.critical} stopOpacity={0.5} />
              <stop offset="100%" stopColor={C.critical} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={C.surfaceAlt} vertical={false} />
          <XAxis dataKey="label" stroke={C.muted} tickLine={false} axisLine={false} fontSize={11} minTickGap={24} />
          <YAxis stroke={C.muted} tickLine={false} axisLine={false} fontSize={12} />
          <Tooltip contentStyle={{ background: C.surfaceAlt, border: "none", borderRadius: 8, color: C.fg }} />
          <Area type="monotone" dataKey="total" stroke={C.was} fill="url(#auditFill)" strokeWidth={2} />
          <Area type="monotone" dataKey="denied" stroke={C.critical} fill="url(#auditDeniedFill)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
      <div className="flex gap-4 text-xs text-dash-muted mt-2">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: C.was }} /> 전체 요청
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: C.critical }} /> Denied
        </span>
      </div>
    </Card>
  );
}

function RecentAuditEvents({ events }) {
  const [expandedId, setExpandedId] = useState(null);
  return (
    <Card title="Recent Audit Events" subtitle={`Showing ${Math.min(events.length, 10)} of ${events.length}`}>
      <div className="space-y-1">
        {events.slice(0, 10).map((e) => {
          const isOpen = expandedId === e.id;
          return (
            <div key={e.id}>
              <button
                onClick={() => setExpandedId(isOpen ? null : e.id)}
                className="w-full flex items-center gap-3 py-2 text-left text-xs hover:bg-dash-surfaceAlt/50 rounded-lg px-1"
              >
                <span className="text-dash-faint shrink-0">{isOpen ? "▾" : "▸"}</span>
                <span className="text-dash-faint whitespace-nowrap w-16 shrink-0">
                  {e.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span
                  className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${
                    e.allowed ? "bg-dash-mint/15 text-dash-mint" : "bg-dash-critical/15 text-dash-critical"
                  }`}
                >
                  {e.allowed ? "ALLOWED" : "DENIED"}
                </span>
                <span className="text-dash-fg font-mono shrink-0">{e.verb}</span>
                <span className="text-dash-muted truncate">{e.resource}</span>
                <span className="text-dash-faint truncate ml-auto">{e.user}</span>
              </button>
              {isOpen && (
                <div className="ml-8 mb-2 mt-1 bg-dash-bg rounded-xl p-3 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-xs">
                  <div>
                    <p className="text-dash-faint mb-0.5">User</p>
                    <p className="text-dash-fg font-mono break-all">{e.user}</p>
                  </div>
                  <div>
                    <p className="text-dash-faint mb-0.5">Namespace / Pod</p>
                    <p className="text-dash-fg">{e.namespace}{e.pod ? `/${e.pod}` : ""}</p>
                  </div>
                  <div>
                    <p className="text-dash-faint mb-0.5">Container</p>
                    <p className="text-dash-fg">{e.container || "-"}</p>
                  </div>
                  <div>
                    <p className="text-dash-faint mb-0.5">Node</p>
                    <p className="text-dash-fg">{e.node}</p>
                  </div>
                  <div>
                    <p className="text-dash-faint mb-0.5">Image</p>
                    <p className="text-dash-fg font-mono truncate" title={e.image}>
                      {e.image || "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-dash-faint mb-0.5">출발지 IP</p>
                    <p className="text-dash-fg">{e.sourceIp}</p>
                  </div>
                  <div className="col-span-2 sm:col-span-2">
                    <p className="text-dash-faint mb-0.5">전체 시각</p>
                    <p className="text-dash-fg">{e.timestamp.toLocaleString("ko-KR")}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {events.length === 0 && <p className="text-dash-muted text-xs py-3">이 구간에는 이벤트가 없습니다.</p>}
      </div>
    </Card>
  );
}

/**
 * K8s API 상세 — kube-apiserver 감사 로그 전용 페이지. verb/resource/user
 * 관점에서 "누가 무엇을 시도했고 허용/거부됐는지"를 보여준다. 세 계층 중 유일하게
 * 전용 mock 데이터가 없던 계층이라 이번에 k8sAuditLogs.js로 새로 채워넣었다.
 */
export default function K8sAuditView() {
  const [rangeKey, setRangeKey] = useState("24h");
  const preset = RANGE_PRESETS.find((p) => p.key === rangeKey);

  const events = useMemo(() => {
    const cutoff = MOCK_NOW.getTime() - preset.lookbackMs;
    return K8S_AUDIT_EVENTS.filter((e) => e.timestamp.getTime() > cutoff);
  }, [rangeKey]);

  const deniedCount = events.filter((e) => !e.allowed).length;
  const distinctUsers = new Set(events.map((e) => e.user)).size;
  const verbs = useMemo(() => byVerb(events), [events]);
  const resources = useMemo(() => byResource(events), [events]);
  const users = useMemo(() => byUser(events), [events]);
  const topVerb = verbs[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-dash-fg text-base font-semibold mb-1">K8s API 상세</h2>
          <p className="text-dash-muted text-xs">kube-apiserver 감사 로그 전용 뷰 · verb/resource/user 기준</p>
        </div>
        <TimeRangePicker value={rangeKey} onChange={setRangeKey} />
      </div>

      <div className="flex flex-wrap gap-4">
        <KpiCard label={`Total Audit Events (${preset.label})`} value={events.length.toLocaleString()} />
        <KpiCard label="Denied" value={deniedCount} accent="critical" />
        <KpiCard label="Distinct Users" value={distinctUsers} />
        <KpiCard label="Top Verb" value={topVerb ? `${topVerb.verb} (${topVerb.count})` : "-"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <AuditRateChart events={events} rangeKey={rangeKey} />
        </div>
        <ErrorRateGauge
          events={withLevelAlias(events)}
          title="Deny Rate"
          subtitle="전체 대비 거부된 요청 비중"
          unitLabel="events"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <RankedList title="Verb 분포" subtitle="선택 구간 기준" items={verbs.map((v) => ({ label: v.verb, count: v.count }))} />
        <RankedList
          title="Top Resources"
          subtitle="선택 구간 기준"
          items={resources.map((r) => ({ label: r.resource, count: r.count }))}
        />
        <RankedList title="Top Users" subtitle="선택 구간 기준" items={users.map((u) => ({ label: u.user, count: u.count }))} />
      </div>

      <RecentAuditEvents events={events} />
    </div>
  );
}
