import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { LayoutDashboard, AlertTriangle, Target, Server, ShieldCheck, Globe, Shield, Eye, Boxes, ArrowUp, Wifi, User, LogOut, Loader2, Construction } from "lucide-react";
import LiveTicker from "./components/LiveTicker";
import ToastStack from "./components/ToastStack";
import CriticalToastStack from "./components/CriticalToastStack";
import LoginScreen from "./components/LoginScreen";
import { useLiveAttackFeed } from "./hooks/useLiveFeed";
import { useIncidentStats } from "./hooks/useIncidentStats";
import { useTheme } from "./hooks/useTheme";
import { DISPLAY_TIMEZONE } from "./lib/timezone";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { PollIntervalProvider } from "./context/PollIntervalContext";
import { OverviewLayoutProvider } from "./context/OverviewLayoutContext";
import { TabActivityProvider } from "./context/TabActivityContext";
import {
  OverviewIcon,
  IncidentsIcon,
  AttackIcon,
  InfrastructureIcon,
  AdminIcon,
  WasIcon,
  WafIcon,
  FalcoIcon,
  K8sAuditIcon,
  LogoMarkIcon,
} from "./components/navIcons";

// Views are loaded only on first visit, keeping the initial shell responsive.
const DashboardContent = lazy(() => import("./views/LogDashboard").then((module) => ({ default: module.DashboardContent })));
const IncidentsView = lazy(() => import("./views/IncidentsView"));
const AttackMatrixView = lazy(() => import("./views/AttackMatrixView"));
const InfrastructureView = lazy(() => import("./views/InfrastructureView"));
const AdminAuditView = lazy(() => import("./views/AdminAuditView"));
const WASView = lazy(() => import("./views/WASView"));
const WAFView = lazy(() => import("./views/WAFView"));
const FalcoView = lazy(() => import("./views/FalcoView"));
const K8sAuditView = lazy(() => import("./views/K8sAuditView"));

function ViewLoading() {
  return <div className="min-h-48 grid place-items-center text-dash-muted text-sm"><Loader2 className="w-5 h-5 animate-spin" /> <span className="sr-only">화면을 불러오는 중</span></div>;
}

function KeepAliveTab({ active, children }) { return <section hidden={!active} aria-hidden={!active}><TabActivityProvider active={active}>{children}</TabActivityProvider></section>; }

// Keep high-frequency event polling out of AppShell so a feed update does
// not re-render the active, chart-heavy view.
function LiveFeedLayer({ onInvestigate, onGoToIncident, safeTopRef, sidebarOpen }) {
  const { feed, criticalEvents } = useLiveAttackFeed();
  return <>
    <LiveTicker feed={feed} />
    <CriticalToastStack
      events={criticalEvents}
      onInvestigate={onInvestigate}
      onGoToIncident={onGoToIncident}
      safeTopRef={safeTopRef}
      sidebarOpen={sidebarOpen}
    />
  </>;
}

/**
 * SENTINEL-OPS app shell — left sidebar switches between screens.
 * Setup: npm i recharts (LogDashboard's charts use it too).
 */

// "incidents" 항목의 badge는 고정값이 아니라 activeIncidents(useIncidentStats,
// 실데이터)로 렌더 시점에 채워진다 — Sidebar가 navItems를 prop으로 받는 이유.
const NAV_ITEMS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "incidents", label: "Incidents", icon: AlertTriangle },
  { key: "attack", label: "ATT&CK", icon: Target },
  { key: "infra", label: "Infrastructure", icon: Server },
  { key: "admin", label: "Admin / Audit", icon: ShieldCheck },
  // 팀원 커스텀 아이콘(components/navIcons.jsx)으로 바꾸려면 위 5줄 대신 아래 주석 해제:
  // { key: "overview", label: "Overview", icon: OverviewIcon },
  // { key: "incidents", label: "Incidents", icon: IncidentsIcon },
  // { key: "attack", label: "ATT&CK", icon: AttackIcon },
  // { key: "infra", label: "Infrastructure", icon: InfrastructureIcon },
  // { key: "admin", label: "Admin / Audit", icon: AdminIcon },
];

// 계층별 상세 뷰 — 위 NAV_ITEMS와 별도 그룹으로 사이드바에 노출 (구분선으로 분리).
const LAYER_NAV_ITEMS = [
  { key: "was", label: "WAS", icon: Globe },
  { key: "waf", label: "WAF", icon: Shield },
  { key: "falco", label: "Falco", icon: Eye },
  { key: "k8s-audit", label: "K8s API", icon: Boxes },
  // 팀원 커스텀 아이콘(components/navIcons.jsx)으로 바꾸려면 위 4줄 대신 아래 주석 해제:
  // { key: "was", label: "WAS", icon: WasIcon },
  // { key: "waf", label: "WAF", icon: WafIcon },
  // { key: "falco", label: "Falco", icon: FalcoIcon },
  // { key: "k8s-audit", label: "K8s API", icon: K8sAuditIcon },
];

// Fixed-width inner wrapper + shrinking outer <aside> is what makes the
// collapse animate smoothly instead of content reflowing/wrapping mid-transition.
//
// sticky top-0 h-screen: 예전엔 사이드바가 본문과 같은 문서 흐름 안에 있어서
// 페이지를 스크롤하면 같이 밀려 올라갔다(레이아웃 자체가 flex 2단이고 min-h-screen만
// 써서 실제 스크롤은 body 전체에서 일어남) - sticky+h-screen으로 뷰포트 좌측에
// 붙박이로 고정. overflow-x-hidden은 접힘 트랜지션(w-60 -> w-0) 중 내용이 삐져나가는
// 것만 잘라내고, 세로는 내부 wrapper의 overflow-y-auto가 맡아서 메뉴가 화면보다
// 길어져도 사이드바만 독립적으로 스크롤되고 본문 스크롤과는 안 섞인다.
function Sidebar({ active, onSelect, open, incidentBadge, layerNavEndRef }) {
  return (
    <aside
      className={`sticky top-0 h-screen shrink-0 flex flex-col bg-dash-bg border-r border-dash-surfaceAlt overflow-x-hidden transition-all duration-200 ease-in-out ${
        open ? "w-60" : "w-0 border-r-0"
      }`}
    >
      <div className="w-60 h-full flex flex-col px-5 py-6 overflow-y-auto">
        <div className="flex items-center gap-2 mb-8 px-1">
          <div className="w-8 h-8 rounded-lg bg-dash-mint/20 flex items-center justify-center shrink-0 glow-box-mint">
            <LogoMarkIcon className="w-5 h-5 text-dash-mint" />
          </div>
          <div>
            <p className="text-dash-fg font-semibold text-sm leading-none tracking-wide glow-mint">SENTINEL-OPS</p>
            <p className="text-dash-muted text-[10px] mt-1">K8s 기반 SIEM 플랫폼</p>
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
              {/* 팀원 버전(gap-2.5, truncate 없음, strokeWidth 기본값)으로 바꾸려면
                  아래 span 대신: <span className="flex items-center gap-2.5">
                  <item.icon className="w-4 h-4 shrink-0" /><span>{item.label}</span></span> */}
              <span className="flex items-center gap-2 min-w-0">
                <item.icon className="w-4 h-4 shrink-0" strokeWidth={2} />
                <span className="truncate">{item.label}</span>
              </span>
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
              ref={item.key === "k8s-audit" ? layerNavEndRef : undefined}
              onClick={() => onSelect(item.key)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm border-l-2 transition-colors ${
                active === item.key
                  ? "bg-dash-surface text-dash-fg border-dash-mint"
                  : "border-transparent text-dash-muted hover:bg-dash-surface/60 hover:text-dash-fg"
              }`}
            >
              {/* 팀원 버전(gap-2.5, truncate 없음, strokeWidth 기본값)으로 바꾸려면
                  아래 span 대신: <span className="flex items-center gap-2.5">
                  <item.icon className="w-4 h-4 shrink-0" /><span>{item.label}</span></span> */}
              <span className="flex items-center gap-2 min-w-0">
                <item.icon className="w-4 h-4 shrink-0" strokeWidth={2} />
                <span className="truncate">{item.label}</span>
              </span>
            </button>
          ))}
        </nav>
      </div>
    </aside>
  );
}

// 페이지(<main>, AppShell 참고)를 아래로 스크롤하면 나타나는 플로팅 "맨 위로"
// 버튼(2026-07-17 요청) - main 자체가 스크롤 컨테이너(overflow-y-auto)라
// window가 아니라 그 요소의 scrollTop을 직접 구독한다. 배경(bg-dash-surface)/
// 테두리(border-dash-surfaceAlt)는 이미 다크/라이트 각각 정의돼 있는 테마
// 토큰이라 여기서 별도로 명도를 고민할 필요 없이 두 모드 다 배경과 자연스럽게
// 구분된다.
function ScrollToTopButton({ scrollRef }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onScroll = () => setVisible(el.scrollTop > 400);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollRef]);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="맨 위로 이동"
      className="fixed bottom-6 right-6 z-30 w-10 h-10 rounded-full flex items-center justify-center bg-dash-surface border border-dash-surfaceAlt text-dash-fg shadow-lg hover:bg-dash-surfaceAlt transition-colors"
    >
      <ArrowUp className="w-5 h-5" strokeWidth={2} />
    </button>
  );
}

function StatBlock({ label, value, valueClassName = "text-dash-fg", icon: Icon }) {
  return (
    <div>
      <p className="text-dash-muted text-[10px] flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3" />}
        {label}
      </p>
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
            <span className="flex items-center gap-1 text-dash-fg">
              <User className="w-3.5 h-3.5" strokeWidth={2} />
              {username}
            </span>
            <button
              onClick={logout}
              className="flex items-center gap-1 text-dash-muted hover:text-dash-critical px-1.5 py-1 rounded-md hover:bg-dash-surfaceAlt"
            >
              <LogOut className="w-3.5 h-3.5" strokeWidth={2} />
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
      <span className="flex items-center gap-1.5">
        <Wifi className="w-3.5 h-3.5" strokeWidth={2} />
        WAS · WAF · Falco · K8s-Audit 연결됨
      </span>
    </div>
  );
}

function Placeholder({ label }) {
  return (
    <div className="bg-dash-surface rounded-2xl p-10 text-center">
      <Construction className="w-6 h-6 mx-auto mb-2 text-dash-muted" strokeWidth={2} />
      <p className="text-dash-fg text-sm font-medium mb-1">{label}</p>
      <p className="text-dash-muted text-xs">아직 목업이 없어서 자리만 잡아둔 화면이에요 — 화면 주면 채워줄게.</p>
    </div>
  );
}

// 로그인 이후에만 렌더되는 실제 대시보드 셸. App() 아래에서 AuthProvider로
// 감싼 채로만 마운트되므로 useAuth()가 항상 값을 갖는다.
function AppShell() {
  const [active, setActive] = useState("overview");
  const [visitedTabs, setVisitedTabs] = useState(() => new Set(["overview"]));
  useEffect(() => { setVisitedTabs((tabs) => tabs.has(active) ? tabs : new Set([...tabs, active])); }, [active]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const mainRef = useRef(null);
  // CRITICAL 알림은 이 메뉴 아래의 남는 세로 공간만 사용한다. 화면 높이가
  // 작은 경우에도 계층별 로그 메뉴(Falco/K8s API)를 덮지 않게 하는 기준선이다.
  const layerNavEndRef = useRef(null);
  // 2026-07-16: ATT&CK 매트릭스에서 "진행중" 인시던트의 "조치하러 가기" 버튼을
  // 누르면 Incidents 탭으로 전환하면서 그 인시던트를 바로 선택해서 보여준다.
  // pendingIncidentId가 바뀔 때마다 IncidentsView에 새로 전달돼서(참조가 매번
  // 바뀌도록 { id, nonce } 형태로 감쌌다 - 같은 인시던트를 연달아 눌러도 항상
  // 다시 선택되게) useEffect가 selectedId를 그 값으로 맞춘다.
  // 2026-07-17: CRITICAL 토스트의 "스토리라인 보기" 버튼도 이 함수를 그대로
  // 재사용한다 - GET /events/{event_id}/incident로 이미 정확한 incidentId를
  // 들고 있는 상태라 IncidentsView 쪽 이벤트 매칭 로직이 더 필요 없어졌다.
  const [pendingIncident, setPendingIncident] = useState(null);
  function goToIncident(incidentId) {
    setPendingIncident({ id: incidentId, nonce: Date.now() });
    setActive("incidents");
  }
  // Fake response actions live here (not inside IncidentsView) so they
  // survive switching tabs — IncidentsView unmounts when you navigate away,
  // so anything stored only in its local state would reset.
  const [toasts, setToasts] = useState([]);
  const { stats: incidentStats, summary: incidentSummary, reload: reloadIncidentStats } = useIncidentStats();

  function pushToast(message, tone = "success") {
    const toastId = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id: toastId, message, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== toastId)), 3000);
  }

  // font-sans를 안 쓴다(2026-07-16, 2026-07-17 Pretendard 전환 이후에도 유지) -
  // Tailwind font-sans는 클래스 선택자라 index.css의 `body { font-family: ... }`
  // (태그 선택자)보다 우선순위가 높아서, 여기 있으면 body에 지정한 Pretendard가
  // 항상 Tailwind 기본 산세리프로 덮어써져 화면에 반영이 안 된다.
  return (
    <div className="flex min-h-screen bg-dash-bg">
      <Sidebar
        active={active}
        onSelect={setActive}
        open={sidebarOpen}
        incidentBadge={incidentStats.activeIncidents}
        layerNavEndRef={layerNavEndRef}
      />
      <div className="flex-1 flex flex-col min-h-screen min-w-0">
        <TopBar
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
          incidentStats={incidentStats}
        />
        <ConnectionBar />
        <main ref={mainRef} className="flex-1 p-6 overflow-y-auto">
          <Suspense fallback={<ViewLoading />}>
            {visitedTabs.has("overview") && <KeepAliveTab active={active === "overview"}><DashboardContent /></KeepAliveTab>}
            {visitedTabs.has("incidents") && <KeepAliveTab active={active === "incidents"}><IncidentsView pushToast={pushToast} pendingIncident={pendingIncident} summary={incidentSummary} reloadIncidentStats={reloadIncidentStats} /></KeepAliveTab>}
            {visitedTabs.has("attack") && <KeepAliveTab active={active === "attack"}><AttackMatrixView onNavigateToIncident={goToIncident} /></KeepAliveTab>}
            {visitedTabs.has("infra") && <KeepAliveTab active={active === "infra"}><InfrastructureView /></KeepAliveTab>}
            {visitedTabs.has("admin") && <KeepAliveTab active={active === "admin"}><AdminAuditView pushToast={pushToast} /></KeepAliveTab>}
            {visitedTabs.has("was") && <KeepAliveTab active={active === "was"}><WASView /></KeepAliveTab>}
            {visitedTabs.has("waf") && <KeepAliveTab active={active === "waf"}><WAFView /></KeepAliveTab>}
            {visitedTabs.has("falco") && <KeepAliveTab active={active === "falco"}><FalcoView /></KeepAliveTab>}
            {visitedTabs.has("k8s-audit") && <KeepAliveTab active={active === "k8s-audit"}><K8sAuditView /></KeepAliveTab>}
          </Suspense>
        </main>
        <LiveFeedLayer
          onInvestigate={() => setActive("incidents")}
          onGoToIncident={goToIncident}
          safeTopRef={layerNavEndRef}
          sidebarOpen={sidebarOpen}
        />
      </div>
      <ScrollToTopButton scrollRef={mainRef} />
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
        <p className="text-dash-muted text-sm flex items-center gap-1.5">
          <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
          세션 확인 중...
        </p>
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
