import React, { useEffect, useState } from "react";
import { DashboardContent } from "./LogDashboard";
import IncidentsView from "./IncidentsView";
import AttackMatrixView from "./AttackMatrixView";
import InfrastructureView from "./InfrastructureView";
import AdminAuditView from "./AdminAuditView";
import LiveTicker from "./LiveTicker";
import CriticalAlertPopup from "./CriticalAlertPopup";
import ToastStack from "./ToastStack";
import { useLiveAttackFeed } from "./useLiveFeed";
import { incidentStats } from "./incidents";
import { SEED_AUDIT_LOG } from "./auditLog";

/**
 * SENTINEL-OPS app shell — left sidebar switches between screens.
 * Setup: npm i recharts (LogDashboard's charts use it too).
 */

const NAV_ITEMS = [
  { key: "overview", label: "Overview" },
  { key: "incidents", label: "Incidents", badge: incidentStats.activeIncidents },
  { key: "attack", label: "ATT&CK" },
  { key: "infra", label: "Infrastructure" },
  { key: "admin", label: "Admin / Audit" },
];

function Sidebar({ active, onSelect }) {
  return (
    <aside className="hidden lg:flex w-60 shrink-0 flex-col bg-dash-bg border-r border-dash-surfaceAlt px-5 py-6">
      <div className="flex items-center gap-2 mb-8 px-1">
        <div className="w-8 h-8 rounded-lg bg-dash-mint/20 flex items-center justify-center">
          <span className="w-3 h-3 rounded-sm bg-dash-mint" />
        </div>
        <div>
          <p className="text-white font-semibold text-sm leading-none">SENTINEL-OPS</p>
          <p className="text-dash-muted text-[10px] mt-1">Juice Shop 침투 시나리오</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            onClick={() => onSelect(item.key)}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors ${
              active === item.key
                ? "bg-dash-surface text-white"
                : "text-dash-muted hover:bg-dash-surface/60 hover:text-white"
            }`}
          >
            <span>{item.label}</span>
            {item.badge ? (
              <span className="text-[10px] bg-dash-pink/20 text-dash-pink rounded-full px-1.5 py-0.5">
                {item.badge}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
    </aside>
  );
}

function StatBlock({ label, value, valueClassName = "text-white" }) {
  return (
    <div>
      <p className="text-dash-muted text-[10px]">{label}</p>
      <p className={`text-sm font-semibold ${valueClassName}`}>{value}</p>
    </div>
  );
}

function TopBar() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const time = now.toLocaleTimeString("en-GB", { hour12: false });
  const date = now.toISOString().slice(0, 10);

  return (
    <header className="flex flex-wrap items-center gap-x-8 gap-y-2 px-6 py-4 border-b border-dash-surfaceAlt">
      <StatBlock label="진행중 INCIDENT" value={incidentStats.activeIncidents} valueClassName="text-dash-pink" />
      <StatBlock label="총 DETECTED" value={incidentStats.totalDetected.toLocaleString()} />
      <StatBlock label="오픈 ALERT" value={incidentStats.openAlerts} valueClassName="text-dash-mint" />
      <StatBlock label="총 BLOCKED" value={incidentStats.totalBlocked} />

      <div className="ml-auto flex items-center gap-3 text-xs text-dash-muted">
        <span className="flex items-center gap-1.5 text-dash-mint font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-dash-mint inline-block animate-pulse" /> LIVE
        </span>
        <span>
          {time} {date} UTC+9
        </span>
      </div>
    </header>
  );
}

function ConnectionBar() {
  return (
    <div className="flex items-center justify-end px-6 py-2 border-b border-dash-surfaceAlt text-xs text-dash-muted">
      <span>WAS · Falco · K8s-Audit 연결됨</span>
    </div>
  );
}

function Placeholder({ label }) {
  return (
    <div className="bg-dash-surface rounded-2xl p-10 text-center">
      <p className="text-white text-sm font-medium mb-1">{label}</p>
      <p className="text-dash-muted text-xs">아직 목업이 없어서 자리만 잡아둔 화면이에요 — 화면 주면 채워줄게.</p>
    </div>
  );
}

export default function App() {
  const [active, setActive] = useState("incidents");
  const { feed, lastCritical } = useLiveAttackFeed();

  // Fake response actions live here (not inside IncidentsView) so they
  // survive switching tabs — IncidentsView unmounts when you navigate away,
  // so anything stored only in its local state would reset.
  const [auditLog, setAuditLog] = useState(SEED_AUDIT_LOG);
  const [toasts, setToasts] = useState([]);
  const [resolvedIncidentIds, setResolvedIncidentIds] = useState({});
  const [actedEventIds, setActedEventIds] = useState({});

  function logAction({ action, target, ip, user = "용욱님" }) {
    setAuditLog((prev) => [{ id: Date.now(), timestamp: new Date(), user, action, target, ip }, ...prev]);
    const toastId = Date.now() + 1;
    setToasts((prev) => [...prev, { id: toastId, message: action, tone: "success" }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== toastId)), 3000);
  }

  function resolveIncident(incident) {
    setResolvedIncidentIds((prev) => ({ ...prev, [incident.id]: true }));
    logAction({
      action: `인시던트 조사 완료 처리 (${incident.id})`,
      target: incident.target,
      ip: incident.sourceIp,
    });
  }

  function actOnEvent(event) {
    setActedEventIds((prev) => ({ ...prev, [event.id]: true }));
    logAction({
      action: `IP 차단 완료 (${event.sourceIp})`,
      target: `${event.namespace}/${event.pod}`,
      ip: event.sourceIp,
    });
  }

  return (
    <div className="flex min-h-screen bg-dash-bg font-sans">
      <Sidebar active={active} onSelect={setActive} />
      <div className="flex-1 flex flex-col min-h-screen min-w-0">
        <TopBar />
        <ConnectionBar />
        <main className="flex-1 p-6 overflow-y-auto min-w-0">
          {active === "overview" && <DashboardContent />}
          {active === "incidents" && (
            <IncidentsView
              resolvedIncidentIds={resolvedIncidentIds}
              onResolveIncident={resolveIncident}
              actedEventIds={actedEventIds}
              onActOnEvent={actOnEvent}
            />
          )}
          {active === "attack" && <AttackMatrixView />}
          {active === "infra" && <InfrastructureView />}
          {active === "admin" && <AdminAuditView auditLog={auditLog} />}
        </main>
        <LiveTicker feed={feed} />
      </div>
      <CriticalAlertPopup event={lastCritical} onInvestigate={() => setActive("incidents")} />
      <ToastStack toasts={toasts} />
    </div>
  );
}
