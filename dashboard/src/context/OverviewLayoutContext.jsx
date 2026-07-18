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
//
// minW/minH(2026-07-17 요청 - "리사이즈해도 내용이 안 잘리는 최소 크기") -
// KPI 카드는 Playwright로 실제 렌더링해서 재봤다(라벨+값+델타 3줄 내용이
// 116~118px 밑에서는 세로로 잘림, 폭은 텍스트가 줄바꿈돼서 하드 최솟값이
// 없어 시각적으로 봐줄만한 선으로 잡음). 나머지 차트/테이블/지도 타입은
// 전부 Playwright로 하나하나 재기엔 조합이 너무 많아서(범례 줄바꿈, 축 라벨
// 개수가 데이터에 따라 달라짐 등), KPI 카드 실측 비율(기본 크기 대비 약
// 60~65%)을 기준으로 위젯 성격(차트 vs 테이블 vs 지도)에 맞게 비례 추정했다 -
// 정확한 값이 필요하면 문제되는 위젯을 짚어주면 그것부터 다시 실측하겠다.
//
// selfResponsive: true(2026-07-17 버그 수정) - recharts 차트류는 이미 자기
// 내부에서 ResponsiveContainer로 박스 크기를 따라간다(LogDashboard.jsx의
// isControlled 분기 참고). WidgetFrame의 useContentScale(고정 크기로 렌더한
// 뒤 transform:scale로 확대)을 여기에도 같이 적용했더니, 차트를 담은 Card의
// CSS min-h-80(320px)이 useContentScale이 강제한 더 작은 높이를 무시하고
// 커져버려서 그 위에 scale까지 겹쳐 두 배로 부풀어 오르는 버그가 났다
// (Playwright로 실측: 216px로 강제하려던 게 실제로는 399px까지 커짐) -
// 이미 반응형인 타입은 useContentScale을 아예 건너뛰어서 자체 반응형 로직만
// 쓰게 한다.
export const WIDGET_CATALOG = [
  { type: "kpi-total", label: "Total Logs", w: 3, h: 6, minW: 2, minH: 4 },
  { type: "kpi-errors", label: "Errors", w: 3, h: 6, minW: 2, minH: 4 },
  { type: "kpi-warnings", label: "Warnings", w: 3, h: 6, minW: 2, minH: 4 },
  { type: "kpi-sources", label: "Active Sources", w: 3, h: 6, minW: 2, minH: 4 },
  {
    type: "log-volume",
    label: "Log Volume",
    w: 8,
    h: 9,
    minW: 5,
    minH: 6,
    selfResponsive: true,
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
    minW: 3,
    minH: 6,
    selfResponsive: true,
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
    minW: 3,
    minH: 6,
    selfResponsive: true,
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
    minW: 3,
    minH: 6,
    selfResponsive: true,
    chartTypeOptions: [
      { value: "donut", label: "도넛" },
      { value: "bar", label: "막대" },
    ],
  },
  {
    type: "donut-k8s-namespace",
    label: "K8s 네임스페이스 분포",
    w: 4,
    h: 9,
    minW: 3,
    minH: 6,
    selfResponsive: true,
    chartTypeOptions: [
      { value: "donut", label: "도넛" },
      { value: "bar", label: "막대" },
    ],
  },
  { type: "latency-stats", label: "API Latency", w: 12, h: 5, minW: 8, minH: 4 },
  { type: "module-volume", label: "모듈별 로그량 추이", w: 8, h: 9, minW: 5, minH: 6, selfResponsive: true },
  { type: "recent-logs", label: "Recent Logs", w: 8, h: 14, minW: 5, minH: 8 },
  { type: "top-sources", label: "Top Sources", w: 4, h: 7, minW: 3, minH: 5 },
  { type: "error-rate", label: "Error Rate", w: 4, h: 7, minW: 3, minH: 5 },
  { type: "geo-summary", label: "지역별 분포", w: 12, h: 11, minW: 6, minH: 7, selfResponsive: true },
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
