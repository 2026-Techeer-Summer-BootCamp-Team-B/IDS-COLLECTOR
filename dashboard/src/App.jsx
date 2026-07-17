import React, { useEffect, useState } from "react";
import { DashboardContent } from "./views/LogDashboard";
import IncidentsView from "./views/IncidentsView";
import AttackMatrixView from "./views/AttackMatrixView";
import InfrastructureView from "./views/InfrastructureView";
import AdminAuditView from "./views/AdminAuditView";
import WASView from "./views/WASView";
import WAFView from "./views/WAFView";
import FalcoView from "./views/FalcoView";
import K8sAuditView from "./views/K8sAuditView";
import LiveTicker from "./components/LiveTicker";
import ToastStack from "./components/ToastStack";
import LoginScreen from "./components/LoginScreen";
import { SOURCE_META } from "./components/badges";
import { useLiveAttackFeed } from "./hooks/useLiveFeed";
import { useIncidentStats } from "./hooks/useIncidentStats";
import { useTheme } from "./hooks/useTheme";
import { forTheme } from "./data/theme";
import { DISPLAY_TIMEZONE } from "./lib/timezone";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { PollIntervalProvider } from "./context/PollIntervalContext";
import { OverviewLayoutProvider } from "./context/OverviewLayoutContext";

/**
 * SENTINEL-OPS app shell — left sidebar switches between screens.
 * Setup: npm i recharts (LogDashboard's charts use it too).
 */

// "incidents" 항목의 badge는 고정값이 아니라 activeIncidents(useIncidentStats,
// 실데이터)로 렌더 시점에 채워진다 — Sidebar가 navItems를 prop으로 받는 이유.
const NAV_ITEMS = [
  { key: "overview", label: "Overview" },
  { key: "incidents", label: "Incidents" },
  { key: "attack", label: "ATT&CK" },
  { key: "infra", label: "Infrastructure" },
  { key: "admin", label: "Admin / Audit" },
];

// 계층별 상세 뷰 — 위 NAV_ITEMS와 별도 그룹으로 사이드바에 노출 (구분선으로 분리).
const LAYER_NAV_ITEMS = [
  { key: "was", label: "WAS" },
  { key: "waf", label: "WAF" },
  { key: "falco", label: "Falco" },
  { key: "k8s-audit", label: "K8s API" },
];

// CRITICAL(severity=4) 이벤트 알림 — 예전엔 화면 우측 상단에 fixed 팝업으로
// 떠서 작업 중인 화면을 가렸다는 피드백을 받고, 사이드바 하단(nav 아래 여백)에
// 자리 잡는 일회성 카드로 옮겼다. dismissedId로 "이 이벤트는 이미 봤음"을
// 기억해서, 조사하기/닫기 중 하나라도 누르면 그 이벤트에 한해 다시 안 뜬다 -
// 다음에 새 CRITICAL 이벤트(다른 id)가 오면 다시 나타남.
function SidebarCriticalAlert({ event, onInvestigate }) {
  const { theme } = useTheme();
  const [dismissedId, setDismissedId] = useState(null);

  if (!event || event.id === dismissedId) return null;

  const src = SOURCE_META[event.source] || { label: event.source, color: "#8890B5" };

  return (
    <div className="mt-4 bg-dash-surface border border-dash-critical rounded-xl p-3 glow-box-critical">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold tracking-wide px-1.5 py-0.5 rounded bg-dash-critical/20 text-dash-critical">
          CRITICAL
        </span>
        <button
          onClick={() => setDismissedId(event.id)}
          aria-label="알림 닫기"
          className="text-dash-muted hover:text-dash-fg text-xs leading-none"
        >
          ✕
        </button>
      </div>
      <p className="text-dash-fg text-xs font-medium mb-1 leading-snug line-clamp-2">{event.message}</p>
      <p className="text-dash-muted text-[10px] mb-2 truncate">
        {event.namespace && `${event.namespace}/${event.pod} · `}
        {event.sourceIp && `${event.sourceIp} · `}
        <span style={{ color: forTheme(src.color, theme) }}>{src.label}</span>
      </p>
      <button
        onClick={() => {
          setDismissedId(event.id);
          onInvestigate?.();
        }}
        className="text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-dash-critical/15 text-dash-critical w-full"
      >
        조사하기 →
      </button>
    </div>
  );
}

// Fixed-width inner wrapper + shrinking outer <aside> is what makes the
// collapse animate smoothly instead of content reflowing/wrapping mid-transition.
function Sidebar({ active, onSelect, open, incidentBadge, lastCritical, onInvestigateCritical }) {
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
              {item.key === "incidents" && incidentBadge ? (
                <span className="text-[10px] bg-dash-pink/20 text-dash-pink rounded-full px-1.5 py-0.5">
                  {incidentBadge}
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

          {/* K8s API(LAYER_NAV_ITEMS 마지막 항목) 바로 아래 - 맨 아래 여백에
              두면 스크롤을 안 내리는 이상 놓치기 쉽다는 피드백으로 여기로 이동. */}
          <SidebarCriticalAlert event={lastCritical} onInvestigate={onInvestigateCritical} />
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

function TopBar({ sidebarOpen, onToggleSidebar, incidentStats }) {
  const [now, setNow] = useState(new Date());
  const { username, logout } = useAuth();
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const time = now.toLocaleTimeString("en-GB", { hour12: false, timeZone: DISPLAY_TIMEZONE });
  // toISOString()은 항상 UTC라 자정 근처(표시 타임존 기준 자정 전)엔 하루 전 날짜가
  // 찍힌다 - en-CA 로케일은 YYYY-MM-DD 포맷을 그대로 주는 몇 안 되는 로케일이라
  // 별도 파싱 없이 씀.
  const date = now.toLocaleDateString("en-CA", { timeZone: DISPLAY_TIMEZONE });

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
        {username && (
          <span className="flex items-center gap-1.5 pl-3 border-l border-dash-surfaceAlt">
            <span className="text-dash-fg">{username}</span>
            <button
              onClick={logout}
              className="text-dash-muted hover:text-dash-critical px-1.5 py-1 rounded-md hover:bg-dash-surfaceAlt"
            >
              로그아웃
            </button>
          </span>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}

function ConnectionBar() {
  return (
    <div className="flex items-center justify-end px-6 py-2 border-b border-dash-surfaceAlt text-xs text-dash-muted">
      <span>WAS · WAF · Falco · K8s-Audit 연결됨</span>
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

// 로그인 이후에만 렌더되는 실제 대시보드 셸. App() 아래에서 AuthProvider로
// 감싼 채로만 마운트되므로 useAuth()가 항상 값을 갖는다.
function AppShell() {
  const [active, setActive] = useState("overview");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // 2026-07-16: ATT&CK 매트릭스에서 "진행중" 인시던트의 "조치하러 가기" 버튼을
  // 누르면 Incidents 탭으로 전환하면서 그 인시던트를 바로 선택해서 보여준다.
  // pendingIncidentId가 바뀔 때마다 IncidentsView에 새로 전달돼서(참조가 매번
  // 바뀌도록 { id, nonce } 형태로 감쌌다 - 같은 인시던트를 연달아 눌러도 항상
  // 다시 선택되게) useEffect가 selectedId를 그 값으로 맞춘다.
  const [pendingIncident, setPendingIncident] = useState(null);
  function goToIncident(incidentId) {
    setPendingIncident({ id: incidentId, nonce: Date.now() });
    setActive("incidents");
  }
  const { feed, lastCritical } = useLiveAttackFeed();

  // Fake response actions live here (not inside IncidentsView) so they
  // survive switching tabs — IncidentsView unmounts when you navigate away,
  // so anything stored only in its local state would reset.
  const [toasts, setToasts] = useState([]);
  const { stats: incidentStats } = useIncidentStats();

  function pushToast(message, tone = "success") {
    const toastId = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id: toastId, message, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== toastId)), 3000);
  }

  // font-sans를 뺐다(2026-07-16) - Tailwind font-sans는 클래스 선택자라
  // index.css의 `body { font-family: var(--dash-font) }`(태그 선택자)보다
  // 우선순위가 높아서, 여기 있으면 글씨체 선택 기능(useFontFamily)이 아무리
  // --dash-font를 바꿔도 항상 Tailwind 기본 산세리프로 덮어써져 화면에
  // 반영이 안 됐다.
  return (
    <div className="flex min-h-screen bg-dash-bg">
      <Sidebar
        active={active}
        onSelect={setActive}
        open={sidebarOpen}
        incidentBadge={incidentStats.activeIncidents}
        lastCritical={lastCritical}
        onInvestigateCritical={() => setActive("incidents")}
      />
      <div className="flex-1 flex flex-col min-h-screen min-w-0">
        <TopBar
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
          incidentStats={incidentStats}
        />
        <ConnectionBar />
        <main className="flex-1 p-6 overflow-y-auto">
          {active === "overview" && <DashboardContent />}
          {active === "incidents" && <IncidentsView pushToast={pushToast} pendingIncident={pendingIncident} />}
          {active === "attack" && <AttackMatrixView onNavigateToIncident={goToIncident} />}
          {active === "infra" && <InfrastructureView />}
          {active === "admin" && <AdminAuditView pushToast={pushToast} />}
          {active === "was" && <WASView />}
          {active === "waf" && <WAFView />}
          {active === "falco" && <FalcoView />}
          {active === "k8s-audit" && <K8sAuditView />}
        </main>
        <LiveTicker feed={feed} />
      </div>
      <ToastStack toasts={toasts} />
    </div>
  );
}

// 로그인 게이트. AuthProvider가 부팅 시 GET /auth/session으로 저장된 토큰을
// 검증하는 동안은 스플래시를, 미인증이면 LoginScreen을, 인증되면 실제 대시보드
// (AppShell)를 보여준다.
function Gate() {
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-dash-bg flex items-center justify-center">
        <p className="text-dash-muted text-sm">세션 확인 중...</p>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return <LoginScreen />;
  }

  return <AppShell />;
}

export default function App() {
  return (
    <AuthProvider>
      <PollIntervalProvider>
        <OverviewLayoutProvider>
          <Gate />
        </OverviewLayoutProvider>
      </PollIntervalProvider>
    </AuthProvider>
  );
}
