import React, { createContext, useContext, useCallback, useState } from "react";

// Overview 페이지 커스텀 대시보드 관리.
//
// "기본 모드"는 activeId === "default"일 때 - LogDashboard.jsx가 기존 정적
// JSX(위젯 변수를 그대로 나열)를 렌더링하며, 이 Context의 어떤 상태도 참조하지
// 않는다. 그래서 커스텀 대시보드를 아무리 만들고 지우고 편집해도 기본 모드는
// 절대 바뀌지 않는다 - 이게 이 구조 전체의 핵심 안전장치.
//
// "커스텀 대시보드"는 여러 개 만들 수 있다(dashboards 배열). 각 대시보드는
// 이름(name)과 위젯 인스턴스 목록(widgets)을 가진다. 위젯 인스턴스는
// { uid, type, x, y, w, h, chartType? } - 같은 type(예: "log-volume")을 여러 번
// 추가할 수 있어서 type이 아니라 uid로 각 인스턴스를 구분한다.
const STORAGE_DASHBOARDS_KEY = "sentinelops_overview_dashboards_v2";
const STORAGE_ACTIVE_KEY = "sentinelops_overview_active_v2";

// 위젯 설정 빌더의 팔레트(왼쪽 목록)에 뜨는 전체 위젯 카탈로그. type은
// LogDashboard.jsx의 renderWidgetContent()가 실제 컴포넌트로 매핑할 때 쓰는 키.
// w/h는 그 위젯을 처음 캔버스에 놓을 때 기본 크기(12칸 그리드 기준).
// icon: 위젯 설정 팔레트에서 라벨 글씨만으로는 뭔지 안 보인다는 2026-07-18
// 피드백으로 추가 - LogDashboard.jsx의 WidgetPreviewIcon이 이 값으로 작은
// 미리보기 아이콘을 그린다(실제 차트를 그대로 축소하는 대신, 종류를 대표하는
// 간단한 도형 - 실제 위젯 렌더링은 데이터 fetch가 필요해서 팔레트 단계에선
// 무겁고, chartTypeOptions가 있는 위젯은 그 중 첫 옵션 모양을 대표로 쓴다).
export const WIDGET_CATALOG = [
  { type: "kpi-total", label: "Total Logs", w: 3, h: 6, icon: "number" },
  { type: "kpi-errors", label: "Errors", w: 3, h: 6, icon: "number" },
  { type: "kpi-warnings", label: "Warnings", w: 3, h: 6, icon: "number" },
  { type: "kpi-sources", label: "탐지 시나리오", w: 3, h: 6, icon: "number" },
  {
    type: "log-volume",
    label: "Log Volume",
    w: 8,
    h: 9,
    icon: "area",
    chartTypeOptions: [
      { value: "area", label: "영역" },
      { value: "bar", label: "막대" },
    ],
  },
  {
    type: "level-distribution",
    label: "Log Levels",
    w: 4,
    h: 9,
    icon: "bar",
    chartTypeOptions: [
      { value: "bar", label: "막대" },
      { value: "donut", label: "도넛" },
    ],
  },
  {
    type: "donut-source",
    label: "탐지 소스별 분포",
    w: 4,
    h: 9,
    icon: "donut",
    chartTypeOptions: [
      { value: "donut", label: "도넛" },
      { value: "bar", label: "막대" },
    ],
  },
  {
    type: "donut-severity",
    label: "심각도 분포",
    w: 4,
    h: 9,
    icon: "donut",
    chartTypeOptions: [
      { value: "donut", label: "도넛" },
      { value: "bar", label: "막대" },
    ],
  },
  // type 키는 "donut-k8s-namespace" 그대로 유지 - 2026-07-17에 K8s 네임스페이스별
  // 분포 도넛에서 계층별 공격 통계로 내용만 교체했다(LogDashboard.jsx의
  // LayerAttackStatsCompact 참고). 이 type을 바꾸면 이미 저장된 커스텀
  // 대시보드(localStorage)에 이 타입으로 박혀있는 위젯이 CATALOG_BY_TYPE에서
  // 안 찾아져서 통째로 사라진다 - 그래서 라벨/차트타입만 바꾸고 키는 안 건드림.
  { type: "donut-k8s-namespace", label: "계층별 공격 통계", w: 4, h: 9, icon: "hbar" },
  { type: "latency-stats", label: "API Latency", w: 12, h: 5, icon: "gauge" },
  { type: "module-volume", label: "모듈별 로그량 추이", w: 8, h: 9, icon: "area" },
  { type: "recent-logs", label: "Recent Logs", w: 8, h: 14, icon: "list" },
  { type: "top-sources", label: "Top Sources", w: 4, h: 7, icon: "list" },
  { type: "error-rate", label: "Error Rate", w: 4, h: 7, icon: "gauge" },
  { type: "geo-summary", label: "지역별 분포", w: 12, h: 11, icon: "map" },
  // 2026-07-16(8차)에 기본 화면에서 뺐던 위젯 - 2026-07-18, "위젯 목록에 다시
  // 추가해달라"는 요청으로 선택적 위젯(카탈로그에만)으로 복원.
  { type: "activity-flow", label: "실시간 탐지", w: 12, h: 12, icon: "pulse" },
];

const CATALOG_BY_TYPE = Object.fromEntries(WIDGET_CATALOG.map((w) => [w.type, w]));

export function catalogEntry(type) {
  return CATALOG_BY_TYPE[type];
}

export function chartTypeOptionsFor(type) {
  return CATALOG_BY_TYPE[type]?.chartTypeOptions;
}

export function defaultChartTypeFor(type) {
  return CATALOG_BY_TYPE[type]?.chartTypeOptions?.[0]?.value;
}

let uidCounter = 0;
export function makeWidgetUid() {
  uidCounter += 1;
  return `w${Date.now().toString(36)}${uidCounter}`;
}

function loadDashboards() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_DASHBOARDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 저장된 데이터 중 지금 카탈로그에 없는 위젯 타입이 섞여있으면(위젯이
    // 제거된 배포 등) 그 위젯만 걸러내고 나머지는 그대로 유지 - 대시보드
    // 하나가 통째로 깨지는 것보다 안전.
    return parsed
      .filter((d) => d && typeof d.id === "string" && typeof d.name === "string" && Array.isArray(d.widgets))
      .map((d) => ({
        ...d,
        widgets: d.widgets.filter((w) => w && typeof w.uid === "string" && CATALOG_BY_TYPE[w.type]),
      }));
  } catch {
    return [];
  }
}

function loadActiveId(dashboards) {
  if (typeof window === "undefined") return "default";
  const raw = window.localStorage.getItem(STORAGE_ACTIVE_KEY) || "default";
  if (raw === "default") return "default";
  return dashboards.some((d) => d.id === raw) ? raw : "default";
}

const OverviewLayoutContext = createContext(null);

export function OverviewLayoutProvider({ children }) {
  const [dashboards, setDashboardsState] = useState(loadDashboards);
  const [activeId, setActiveIdState] = useState(() => loadActiveId(loadDashboards()));

  const persistDashboards = useCallback((next) => {
    setDashboardsState(next);
    try {
      window.localStorage.setItem(STORAGE_DASHBOARDS_KEY, JSON.stringify(next));
    } catch {
      // 무시
    }
  }, []);

  const setActiveId = useCallback((id) => {
    setActiveIdState(id);
    try {
      window.localStorage.setItem(STORAGE_ACTIVE_KEY, id);
    } catch {
      // 무시
    }
  }, []);

  // 새 커스텀 대시보드 생성. widgets는 빌더에서 만든 [{uid,type,x,y,w,h,chartType}] 배열.
  const createDashboard = useCallback(
    (name, widgets) => {
      const id = `dash_${makeWidgetUid()}`;
      const next = [...dashboards, { id, name, widgets }];
      persistDashboards(next);
      setActiveId(id);
      return id;
    },
    [dashboards, persistDashboards, setActiveId]
  );

  // 기존 대시보드 갱신 - 빌더에서 위젯을 추가/삭제하고 저장하거나, 그리드에서
  // 드래그/리사이즈해서 위치가 바뀌었을 때(자동 저장) 둘 다 이 함수를 쓴다.
  const updateDashboard = useCallback(
    (id, patch) => {
      const next = dashboards.map((d) => (d.id === id ? { ...d, ...patch } : d));
      persistDashboards(next);
    },
    [dashboards, persistDashboards]
  );

  const deleteDashboard = useCallback(
    (id) => {
      const next = dashboards.filter((d) => d.id !== id);
      persistDashboards(next);
      if (activeId === id) setActiveId("default");
    },
    [dashboards, persistDashboards, activeId, setActiveId]
  );

  const getDashboard = useCallback((id) => dashboards.find((d) => d.id === id), [dashboards]);

  return (
    <OverviewLayoutContext.Provider
      value={{
        dashboards,
        activeId,
        setActiveId,
        createDashboard,
        updateDashboard,
        deleteDashboard,
        getDashboard,
      }}
    >
      {children}
    </OverviewLayoutContext.Provider>
  );
}

export function useOverviewLayout() {
  const ctx = useContext(OverviewLayoutContext);
  if (!ctx) {
    return {
      dashboards: [],
      activeId: "default",
      setActiveId: () => {},
      createDashboard: () => {},
      updateDashboard: () => {},
      deleteDashboard: () => {},
      getDashboard: () => undefined,
    };
  }
  return ctx;
}
