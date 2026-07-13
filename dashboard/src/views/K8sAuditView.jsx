import React, { useMemo, useState } from "react";
import { RANGE_PRESETS } from "../data/timeSeries";
import { useLogs } from "../hooks/useLogs";
import TimeRangePicker from "../components/TimeRangePicker";
import RankedList from "../components/RankedList";
import { Card, KpiCard, LogVolumeChart, ErrorRateGauge } from "./LogDashboard";
import { DISPLAY_TIMEZONE } from "../lib/timezone";

// K8s API 서버가 RBAC로 요청을 막으면 HTTP 403을 낸다 — 감사 로그엔 mock처럼
// 별도 allowed/denied 불리언이 없어서, 상태코드 403을 "거부"로 취급한다(다른
// 4xx/5xx는 RBAC과 무관한 클라이언트/서버 오류라 여기 포함하지 않음).
const DENIED_STATUS_CODE = 403;

function RecentAuditEvents({ events, status, error }) {
  const [expandedId, setExpandedId] = useState(null);
  return (
    <Card title="Recent Audit Events" subtitle={`Showing ${Math.min(events.length, 10)} of ${events.length}`}>
      {status === "loading" && <p className="text-dash-muted text-xs py-3">불러오는 중...</p>}
      {status === "error" && <p className="text-dash-critical text-xs py-3">{error}</p>}
      {status === "ready" && (
      <div className="space-y-1">
        {events.slice(0, 10).map((e) => {
          const isOpen = expandedId === e.id;
          const statusCode = e.raw["http.response.status_code"];
          const denied = statusCode === DENIED_STATUS_CODE;
          const verb = e.raw["kubernetes.audit.verb"] || "-";
          const resource = e.raw["orchestrator.resource.type"] || "-";
          const user = e.raw["user.name"] || "-";
          return (
            <div key={e.id}>
              <button
                onClick={() => setExpandedId(isOpen ? null : e.id)}
                className="w-full flex items-center gap-3 py-2 text-left text-xs hover:bg-dash-surfaceAlt/50 rounded-lg px-1"
              >
                <span className="text-dash-faint shrink-0">{isOpen ? "▾" : "▸"}</span>
                <span className="text-dash-faint whitespace-nowrap w-16 shrink-0">
                  {e.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: DISPLAY_TIMEZONE })}
                </span>
                <span
                  className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${
                    denied ? "bg-dash-critical/15 text-dash-critical" : "bg-dash-mint/15 text-dash-mint"
                  }`}
                >
                  {denied ? "DENIED" : "ALLOWED"}
                </span>
                <span className="text-dash-fg font-mono shrink-0">{verb}</span>
                <span className="text-dash-muted truncate">{resource}</span>
                <span className="text-dash-faint truncate ml-auto">{user}</span>
              </button>
              {isOpen && (
                <div className="ml-8 mb-2 mt-1 bg-dash-bg rounded-xl p-3 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-xs">
                  <div>
                    <p className="text-dash-faint mb-0.5">User</p>
                    <p className="text-dash-fg font-mono break-all">{user}</p>
                  </div>
                  <div>
                    <p className="text-dash-faint mb-0.5">Namespace / Pod</p>
                    <p className="text-dash-fg">
                      {e.namespace || "-"}
                      {e.pod ? `/${e.pod}` : ""}
                    </p>
                  </div>
                  <div>
                    <p className="text-dash-faint mb-0.5">Container</p>
                    <p className="text-dash-fg">{e.container || "-"}</p>
                  </div>
                  <div>
                    <p className="text-dash-faint mb-0.5">HTTP Status</p>
                    <p className="text-dash-fg">{statusCode ?? "-"}</p>
                  </div>
                  <div>
                    <p className="text-dash-faint mb-0.5">Image</p>
                    <p className="text-dash-fg font-mono truncate" title={e.image}>
                      {e.image || "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-dash-faint mb-0.5">출발지 IP</p>
                    <p className="text-dash-fg">{e.sourceIp || "-"}</p>
                  </div>
                  <div className="col-span-2 sm:col-span-2">
                    <p className="text-dash-faint mb-0.5">전체 시각</p>
                    <p className="text-dash-fg">{e.timestamp.toLocaleString("ko-KR", { timeZone: DISPLAY_TIMEZONE })}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {events.length === 0 && <p className="text-dash-muted text-xs py-3">이 구간에는 이벤트가 없습니다.</p>}
      </div>
      )}
    </Card>
  );
}

/**
 * K8s API 상세 — GET /logs?module=k8s_audit 실데이터 연동. kube-apiserver 감사
 * 로그엔 mock처럼 별도 allowed/denied 필드가 없어서 HTTP 403(RBAC Forbidden)을
 * "거부"로 취급한다. Log Volume 차트는 다른 상세 뷰와 동일하게 severity>=3
 * (RBAC 민감 verb 등, severity.yaml 참고)을 "주목할 이벤트"로 표시한다.
 */
export default function K8sAuditView() {
  const [rangeKey, setRangeKey] = useState("24h");
  const preset = RANGE_PRESETS.find((p) => p.key === rangeKey);

  const { logs, status, error } = useLogs({ lookbackMs: preset.lookbackMs, module: "k8s_audit", limit: 300 });

  const deniedCount = useMemo(
    () => logs.filter((e) => e.raw["http.response.status_code"] === DENIED_STATUS_CODE).length,
    [logs]
  );
  const distinctUsers = useMemo(
    () => new Set(logs.map((e) => e.raw["user.name"]).filter(Boolean)).size,
    [logs]
  );

  // ErrorRateGauge용 level 별칭 — 거부(403)만 ERROR_BAND로 분류.
  const gaugeEvents = useMemo(
    () => logs.map((e) => ({ ...e, level: e.raw["http.response.status_code"] === DENIED_STATUS_CODE ? "CRITICAL" : "INFO" })),
    [logs]
  );

  function rank(getKey) {
    const counts = {};
    logs.forEach((e) => {
      const key = getKey(e);
      if (!key) return;
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }

  const verbs = useMemo(() => rank((e) => e.raw["kubernetes.audit.verb"]), [logs]);
  const resources = useMemo(() => rank((e) => e.raw["orchestrator.resource.type"]), [logs]);
  const users = useMemo(() => rank((e) => e.raw["user.name"]), [logs]);
  const topVerb = verbs[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-dash-fg text-base font-semibold mb-1">K8s API 상세</h2>
          <p className="text-dash-muted text-xs">kube-apiserver 감사 로그 전용 뷰 (module=k8s_audit) · verb/resource/user 기준</p>
        </div>
        <TimeRangePicker value={rangeKey} onChange={setRangeKey} />
      </div>

      <div className="flex flex-wrap gap-4">
        <KpiCard label={`Total Audit Events (${preset.label})`} value={logs.length.toLocaleString()} />
        <KpiCard label="Denied (HTTP 403)" value={deniedCount} accent="critical" />
        <KpiCard label="Distinct Users" value={distinctUsers} />
        <KpiCard label="Top Verb" value={topVerb ? `${topVerb.label} (${topVerb.count})` : "-"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <LogVolumeChart rangeKey={rangeKey} module="k8s_audit" />
        </div>
        <ErrorRateGauge
          events={gaugeEvents}
          title="Deny Rate"
          subtitle="전체 대비 거부(403) 요청 비중"
          unitLabel="events"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <RankedList title="Verb 분포" subtitle="선택 구간 기준" items={verbs} />
        <RankedList title="Top Resources" subtitle="선택 구간 기준" items={resources} />
        <RankedList title="Top Users" subtitle="선택 구간 기준" items={users} />
      </div>

      <RecentAuditEvents events={logs} status={status} error={error} />
    </div>
  );
}
