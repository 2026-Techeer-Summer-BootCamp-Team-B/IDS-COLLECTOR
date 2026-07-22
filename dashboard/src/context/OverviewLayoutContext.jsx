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
// 없어 시각적으로 봐줄만한 선으로 잡음).
//
// 2026-07-19: 나머지 차트/테이블/지도 타입도 전부 실측으로 교체 - 실제 백엔드에
// 붙인 커스텀 대시보드에서 각 위젯을 단독으로 놓고 h를 한 칸씩 줄여가며(w는
// 필요시 같이) DOM에서 (a) overflow:hidden/text-overflow로 잘리는 요소,
// (b) recharts SVG가 0px로 붕괴하는지, (c) 축/범례 텍스트끼리 겹치는지,
// (d) WidgetFrame의 overflow-auto wrapper가 스크롤이 필요할 만큼(15px 초과)
// 넘치는지 4가지를 측정해서 스크롤 없이 안 잘리고 다 보이는 가장 작은 값을
// 찾았다(이전 버전은 KPI 카드 비율로 비례 추정한 값이었음 - 실측해보니 상당수가
// 부족했다). Log Levels/심각도 분포/탐지소스별 분포는 이 측정 도중 실제
// 버그도 하나 발견: Card가 block 레이아웃이라 도넛/막대 콘텐츠의 height:100%가
// "타이틀 행 아래 남는 공간"이 아니라 Card 전체 높이를 기준으로 계산돼서
// 타이틀 행만큼 항상 넘쳤다(도넛은 아예 0px로 붕괴, 막대는 축 레이블이
// 스크롤해야만 보임) - Card를 flex-col로, 콘텐츠 영역을 flex-1 min-h-0으로
// 바꿔서 고쳤다(WidgetFrame 관련 함수들 주석 참고). Top Source IPs/모듈별
// 로그량 추이/실시간 탐지는 실측 최소값이 기존 기본 배치 크기(w/h)보다 커서
// 기본 크기도 같이 올렸다 - 안 그러면 캔버스에 처음 놓는 순간부터 이미
// 최소치보다 작은 상태가 된다.
//
// 2026-07-19(2차 재측정): "리사이즈로 줄이면 여전히 스크롤이 생긴다"는 재현
// 피드백 - 위 1차 측정이 있던 시점 이후 useAutoFitBox(박스 크기에 맞춰
// 콘텐츠를 transform:scale로 동기화하는 시도)가 한 번 얹혔다가 race condition
// 버그로 다시 빠지면서(LogDashboard.jsx의 WidgetFrame 주석 참고 - "팀원
// 버전(overflow로 그냥 넘치면 스크롤)으로 되돌림") 실제 반영된 값과 이 파일의
// 주석이 어긋나 있었다. Playwright로 각 위젯을 캔버스에 단독으로 놓고
// react-grid-layout의 .react-grid-item에 폭/높이를 직접 주입(드래그가 아니라
// 스타일 직접 조작 - ResizeObserver 기반 recharts ResponsiveContainer는 그래도
// 정상 반응함)한 뒤 WidgetFrame의 overflow-auto wrapper에서 scrollWidth/
// scrollHeight > clientWidth/clientHeight를 이분탐색으로 재확인했다(chartType이
// 여러 개인 위젯은 옵션마다 다 재고 더 큰 쪽을 채택). 새로 측정한 값이 기존
// 값보다 클 때만 올렸다(작게 나온 경우 - 예: latency-stats/geo-summary는
// "스크롤이 안 생기는" 기준으로는 기존 선언값보다 더 작게 잡을 수 있었지만,
// 그건 지도/게이지처럼 내용 자체가 박스 크기에 맞춰 그냥 줄어들 뿐이라 "안
// 잘림"이지 "알아볼 수 있음"이 아니다 - 이 요청의 목적은 축소이지 확대가
// 아니므로 기존 값을 그대로 유지). log-volume/module-volume/recent-logs/
// geo-summary/activity-flow는 특히 크게 올랐다(예: module-volume 10 -> 23,
// activity-flow 13 -> 22) - 전부 기본 배치 크기(w/h)도 새 최소치 밑으로
// 떨어지지 않게 같이 올렸다.
//
// icon: 위젯 설정 팔레트에서 라벨 글씨만으로는 뭔지 안 보인다는 2026-07-18
// 피드백으로 추가 - LogDashboard.jsx의 WidgetPreviewIcon이 이 값으로 작은
// 미리보기 아이콘을 그린다(실제 차트를 그대로 축소하는 대신, 종류를 대표하는
// 간단한 도형 - 실제 위젯 렌더링은 데이터 fetch가 필요해서 팔레트 단계에선
// 무겁고, chartTypeOptions가 있는 위젯은 그 중 첫 옵션 모양을 대표로 쓴다).
export const WIDGET_CATALOG = [
  { type: "kpi-total", label: "Total Logs", w: 3, h: 6, minW: 3, minH: 4, icon: "number" },
  { type: "kpi-errors", label: "Errors", w: 3, h: 6, minW: 3, minH: 4, icon: "number" },
  { type: "kpi-warnings", label: "Warnings", w: 3, h: 6, minW: 3, minH: 4, icon: "number" },
  { type: "kpi-sources", label: "탐지 시나리오", w: 3, h: 6, minW: 3, minH: 4, icon: "number" },
  {
    type: "log-volume",
    label: "Log Volume",
    w: 8,
    h: 14,
    minW: 6,
    minH: 14,
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
    h: 10,
    minW: 3,
    minH: 10,
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
    minW: 3,
    minH: 8,
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
    minW: 3,
    minH: 6,
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
  {
    type: "donut-k8s-namespace",
    label: "계층별 공격 통계",
    w: 4,
    h: 9,
    minW: 3,
    minH: 8,
    icon: "hbar",
    chartTypeOptions: [
      { value: "bar", label: "막대" },
      { value: "donut", label: "도넛" },
    ],
  },
  { type: "latency-stats", label: "API Latency", w: 12, h: 6, minW: 8, minH: 6, icon: "gauge" },
  { type: "module-volume", label: "모듈별 로그량 추이", w: 8, h: 23, minW: 6, minH: 23, icon: "area" },
  { type: "recent-logs", label: "Recent Logs", w: 8, h: 20, minW: 6, minH: 20, icon: "list" },
  { type: "top-sources", label: "Top Sources", w: 4, h: 11, minW: 3, minH: 11, icon: "list" },
  { type: "error-rate", label: "Error Rate", w: 4, h: 8, minW: 3, minH: 8, icon: "gauge" },
  { type: "geo-summary", label: "지역별 분포", w: 12, h: 17, minW: 4, minH: 17, icon: "map" },
  // 2026-07-16(8차)에 기본 화면에서 뺐던 위젯 - 2026-07-18, "위젯 목록에 다시
  // 추가해달라"는 요청으로 선택적 위젯(카탈로그에만)으로 복원.
  { type: "activity-flow", label: "실시간 탐지", w: 12, h: 22, minW: 6, minH: 22, icon: "pulse" },
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
