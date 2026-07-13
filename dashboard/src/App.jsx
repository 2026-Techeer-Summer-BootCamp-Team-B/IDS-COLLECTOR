import React, { useEffect, useState } from "react";
import { DashboardContent } from "./views/LogDashboard";
import IncidentsView from "./views/IncidentsView";
import AttackMatrixView from "./views/AttackMatrixView";
import InfrastructureView from "./views/InfrastructureView";
import AdminAuditView from "./views/AdminAuditView";
import WASView from "./views/WASView";
import FalcoView from "./views/FalcoView";
import K8sAuditView from "./views/K8sAuditView";
import LiveTicker from "./components/LiveTicker";
import CriticalAlertPopup from "./components/CriticalAlertPopup";
import ToastStack from "./components/ToastStack";
import { useLiveAttackFeed } from "./hooks/useLiveFeed";
import { useTheme } from "./hooks/useTheme";
import { incidentStats } from "./data/incidents";
import { SEED_AUDIT_LOG } from "./data/auditLog";
import { RULES } from "./data/rules";
import { INITIAL_LOG_POLICIES, INITIAL_EXCLUSION_RULES } from "./data/logPolicy";

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

// 계층별 상세 뷰 — 위 NAV_ITEMS와 별도 그룹으로 사이드바에 노출 (구분선으로 분리).
const LAYER_NAV_ITEMS = [
  { key: "was", label: "WAS" },
  { key: "falco", label: "Falco" },
  { key: "k8s-audit", label: "K8s API" },
];

// Fixed-width inner wrapper + shrinking outer <aside> is what makes the
// collapse animate smoothly instead of content reflowing/wrapping mid-transition.
function Sidebar({ active, onSelect, open }) {
  return (
    <aside
      className={`shrink-0 flex flex-col bg-dash-bg border-r border-dash-surfaceAlt overflow-hidden transition-all duration-200 ease-in-out ${
        open ? "w-60" : "w-0 border-r-0"
      }`}
    >
      <div className="w-60 h-full flex flex-col px-5 py-6">
        <div className="flex items-center gap-2 mb-8 px-1">
          <div className="w-8 h-8 rounded-lg bg-dash-mint/20 flex items-center justify-center shrink-0 glow-box-mint">
            <span className="w-3 h-3 rounded-sm bg-dash-mint" />
          </div>
          <div>
            <p className="text-dash-fg font-semibold text-sm leading-none tracking-wide glow-mint">SENTINEL-OPS</p>
            <p className="text-dash-muted text-[10px] mt-1">Juice Shop 침투 시나리오</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              onClick={() => onSelect(item.key)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm border-l-2 transition-colors ${
                active === item.key
                  ? "bg-dash-surface text-dash-fg border-dash-mint"
                  : "border-transparent text-dash-muted hover:bg-dash-surface/60 hover:text-dash-fg"
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

          <p className="text-dash-faint text-[10px] uppercase tracking-wide px-3 pt-4 pb-1">계층별 로그</p>
          {LAYER_NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              onClick={() => onSelect(item.key)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm border-l-2 transition-colors ${
                active === item.key
                  ? "bg-dash-surface text-dash-fg border-dash-mint"
                  : "border-transparent text-dash-muted hover:bg-dash-surface/60 hover:text-dash-fg"
              }`}
            >
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </aside>
  );
}

function StatBlock({ label, value, valueClassName = "text-dash-fg" }) {
  return (
    <div>
      <p className="text-dash-muted text-[10px]">{label}</p>
      <p className={`text-sm font-semibold ${valueClassName}`}>{value}</p>
    </div>
  );
}

function SidebarToggle({ open, onToggle }) {
  return (
    <button
      onClick={onToggle}
      aria-label="사이드바 토글"
      title="사이드바 토글"
      className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-dash-muted hover:text-dash-fg hover:bg-dash-surface transition-colors"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </button>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isLight = theme === "light";
  return (
    <button
      onClick={toggleTheme}
      aria-label="라이트/다크 모드 전환"
      title={isLight ? "다크 모드로 전환" : "라이트 모드로 전환"}
      className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-dash-muted hover:text-dash-fg hover:bg-dash-surface transition-colors"
    >
      {isLight ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M8 1.5v2M8 12.5v2M2.6 2.6l1.4 1.4M12 12l1.4 1.4M1.5 8h2M12.5 8h2M2.6 13.4l1.4-1.4M12 4l1.4-1.4"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
          <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M13.5 9.6A5.8 5.8 0 1 1 6.4 2.5a4.6 4.6 0 0 0 7.1 7.1Z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

function TopBar({ sidebarOpen, onToggleSidebar }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const time = now.toLocaleTimeString("en-GB", { hour12: false });
  const date = now.toISOString().slice(0, 10);

  return (
    <header className="flex flex-wrap items-center gap-x-8 gap-y-2 px-6 py-4 border-b border-dash-surfaceAlt">
      <SidebarToggle open={sidebarOpen} onToggle={onToggleSidebar} />
      <StatBlock label="진행중 INCIDENT" value={incidentStats.activeIncidents} valueClassName="text-dash-pink" />
      <StatBlock label="총 DETECTED" value={incidentStats.totalDetected.toLocaleString()} />
      <StatBlock label="오픈 ALERT" value={incidentStats.openAlerts} valueClassName="text-dash-mint" />
      <StatBlock label="총 BLOCKED" value={incidentStats.totalBlocked} />

      <div className="ml-auto flex items-center gap-3 text-xs text-dash-muted">
        <span className="flex items-center gap-1.5 text-dash-mint font-medium glow-mint">
          <span className="w-1.5 h-1.5 rounded-full bg-dash-mint inline-block animate-pulse" /> LIVE
        </span>
        <span>
          {time} {date} UTC+9
        </span>
        <ThemeToggle />
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
      <p className="text-dash-fg text-sm font-medium mb-1">{label}</p>
      <p className="text-dash-muted text-xs">아직 목업이 없어서 자리만 잡아둔 화면이에요 — 화면 주면 채워줄게.</p>
    </div>
  );
}

export default function App() {
  const [active, setActive] = useState("overview");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { feed, lastCritical } = useLiveAttackFeed();

  // Fake response actions live here (not inside IncidentsView) so they
  // survive switching tabs — IncidentsView unmounts when you navigate away,
  // so anything stored only in its local state would reset.
  const [auditLog, setAuditLog] = useState(SEED_AUDIT_LOG);
  const [toasts, setToasts] = useState([]);
  const [resolvedIncidentIds, setResolvedIncidentIds] = useState({});
  const [actedEventIds, setActedEventIds] = useState({});
  const [rules, setRules] = useState(RULES);
  const [logPolicies, setLogPolicies] = useState(INITIAL_LOG_POLICIES);
  const [exclusionRules, setExclusionRules] = useState(INITIAL_EXCLUSION_RULES);

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

  function toggleRule(ruleId) {
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule) return;
    const nextEnabled = !rule.enabled;
    setRules((prev) => prev.map((r) => (r.id === ruleId ? { ...r, enabled: nextEnabled } : r)));
    logAction({
      action: `탐지 룰 ${nextEnabled ? "활성화" : "비활성화"} (${rule.name})`,
      target: rule.id,
      ip: "-",
    });
  }

  function updatePolicy(layer, patch) {
    setLogPolicies((prev) => prev.map((p) => (p.layer === layer ? { ...p, ...patch } : p)));
    logAction({
      action: `데이터 정책 변경 (${layer}: ${Object.entries(patch)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")})`,
      target: layer,
      ip: "-",
    });
  }

  function toggleExclusion(ruleId) {
    const rule = exclusionRules.find((r) => r.id === ruleId);
    if (!rule) return;
    const nextEnabled = !rule.enabled;
    setExclusionRules((prev) => prev.map((r) => (r.id === ruleId ? { ...r, enabled: nextEnabled } : r)));
    logAction({
      action: `제외 규칙 ${nextEnabled ? "활성화" : "비활성화"} (${rule.id})`,
      target: rule.pattern,
      ip: "-",
    });
  }

  return (
    <div className="flex min-h-screen bg-dash-bg font-sans">
      <Sidebar active={active} onSelect={setActive} open={sidebarOpen} />
      <div className="flex-1 flex flex-col min-h-screen min-w-0">
        <TopBar sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((o) => !o)} />
        <ConnectionBar />
        <main className="flex-1 p-6 overflow-y-auto">
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
          {active === "admin" && (
            <AdminAuditView
              auditLog={auditLog}
              rules={rules}
              onToggleRule={toggleRule}
              logPolicies={logPolicies}
              onUpdatePolicy={updatePolicy}
              exclusionRules={exclusionRules}
              onToggleExclusion={toggleExclusion}
            />
          )}
          {active === "was" && <WASView />}
          {active === "falco" && <FalcoView />}
          {active === "k8s-audit" && <K8sAuditView />}
        </main>
        <LiveTicker feed={feed} />
      </div>
      <CriticalAlertPopup event={lastCritical} onInvestigate={() => setActive("incidents")} />
      <ToastStack toasts={toasts} />
    </div>
  );
}
