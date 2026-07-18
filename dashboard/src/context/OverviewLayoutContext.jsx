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
//
// icon: 위젯 설정 팔레트에서 라벨 글씨만으로는 뭔지 안 보인다는 2026-07-18
// 피드백으로 추가 - LogDashboard.jsx의 WidgetPreviewIcon이 이 값으로 작은
// 미리보기 아이콘을 그린다(실제 차트를 그대로 축소하는 대신, 종류를 대표하는
// 간단한 도형 - 실제 위젯 렌더링은 데이터 fetch가 필요해서 팔레트 단계에선
// 무겁고, chartTypeOptions가 있는 위젯은 그 중 첫 옵션 모양을 대표로 쓴다).
export const WIDGET_CATALOG = [
  { type: "kpi-total", label: "Total Logs", w: 3, h: 6, minW: 2, minH: 4, icon: "number" },
  { type: "kpi-errors", label: "Errors", w: 3, h: 6, minW: 2, minH: 4, icon: "number" },
  { type: "kpi-warnings", label: "Warnings", w: 3, h: 6, minW: 2, minH: 4, icon: "number" },
  { type: "kpi-sources", label: "탐지 시나리오", w: 3, h: 6, minW: 2, minH: 4, icon: "number" },
  {
    type: "log-volume",
    label: "Log Volume",
    w: 8,
    h: 9,
    minW: 5,
    minH: 6,
    selfResponsive: true,
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
    minW: 3,
    minH: 6,
    selfResponsive: true,
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
    minH: 6,
    selfResponsive: true,
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
    selfResponsive: true,
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
  // minW/minH/selfResponsive는 원래 이 자리(구 K8s 네임스페이스 도넛)에 있던 값을
  // 그대로 이식 - w/h(4x9)가 안 바뀌었으니 리사이즈 최소크기도 그대로 유효하다.
  {
    type: "donut-k8s-namespace",
    label: "계층별 공격 통계",
    w: 4,
    h: 9,
    minW: 3,
    minH: 6,
    selfResponsive: true,
    icon: "hbar",
  },
  { type: "latency-stats", label: "API Latency", w: 12, h: 5, minW: 8, minH: 4, icon: "gauge" },
  {
    type: "module-volume",
    label: "모듈별 로그량 추이",
    w: 8,
    h: 9,
    minW: 5,
    minH: 6,
    selfResponsive: true,
    icon: "area",
  },
  { type: "recent-logs", label: "Recent Logs", w: 8, h: 14, minW: 5, minH: 8, icon: "list" },
  { type: "top-sources", label: "Top Sources", w: 4, h: 7, minW: 3, minH: 5, icon: "list" },
  { type: "error-rate", label: "Error Rate", w: 4, h: 7, minW: 3, minH: 5, icon: "gauge" },
  {
    type: "geo-summary",
    label: "지역별 분포",
    w: 12,
    h: 11,
    minW: 6,
    minH: 7,
    selfResponsive: true,
    icon: "map",
  },
  // 2026-07-16(8차)에 기본 화면에서 뺐던 위젯 - 2026-07-18, "위젯 목록에 다시
  // 추가해달라"는 요청으로 선택적 위젯(카탈로그에만)으로 복원. LiveActivityTree는
  // recharts ResponsiveContainer를 쓰는 차트가 아니라(자체 레이아웃 컴포넌트)
  // 위 selfResponsive 버그 수정 대상이 아니었어서 minW/minH/selfResponsive는
  // 안 붙인다 - 커스텀 대시보드에서 리사이즈했을 때 문제가 보이면 그때 추가.
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

// LogDashboard.jsx의 두 <ResponsiveGridLayout> JSX(cols/rowHeight/margin
// prop)와 반드시 맞출 것 - 바뀌면 여기도 같이 고쳐야 아래 픽셀 환산이 틀어진다.
const GRID_COLS = 12;
const GRID_ROW_HEIGHT = 20;
const GRID_MARGIN = 16;

function gridColWidth(containerWidth) {
  return (containerWidth - GRID_MARGIN * (GRID_COLS - 1)) / GRID_COLS;
}

// 위젯을 리사이즈(드래그 또는 "높이 -/+" 버튼)할 때 카탈로그의 원래 w/h가
// "실제 컨테이너 폭 기준으로 렌더링됐을 때의 픽셀 비율"을 그대로 유지시킨다 -
// LogDashboard.jsx의 WidgetFrame이 selfResponsive가 아닌 위젯에 쓰는
// useAutoFitBox는 scale = Math.min(w/baseline.w, h/baseline.h)로 계산해서,
// 박스의 "픽셀" 비율이 기준선(=최초 카탈로그 w/h가 렌더링된 실제 px)과
// 달라지면 두 비율 중 더 작은 쪽에 맞춰져 콘텐츠가 박스를 못 채우고 빈
// 공간이 남는 버그가 있었다(2026-07-18).
//
// 그리드 "단위"(w/h, 컬럼/행 개수) 비율만 고정하는 걸로는 부족하다 - 컬럼
// 폭(colWidth, containerWidth에 따라 달라짐)과 행 높이(rowHeight=20, 고정)가
// 서로 다른 단위라, 단위 비율을 그대로 유지해도 실제 px 비율은 박스가
// 커질수록 조금씩 어긋난다(실측 확인: kpi-total을 3x6→4x8로 그리드 비율만
// 맞춰 키웠는데도 콘텐츠와 박스 사이에 135px 간극이 남았음). react-grid-layout
// v2의 내장 aspectRatio() constraint가 쓰는 것과 동일한 공식
// (colWidth*w+margin*(w-1) 형태)으로 px 단위까지 맞춘다 - 그 constraint
// 자체는 이 프로젝트가 쓰는 legacy 호환 래퍼에서 per-item 설정이 무시돼서
// (레거시 래퍼가 top-level constraints를 defaultConstraints로 하드코딩,
// applyLayoutToWidgets 주석 참고) 못 쓰고 같은 공식을 여기서 직접 재구현.
//
// oldW/oldH와 다른 축(사용자가 실제로 드래그/클릭한 쪽)을 "주도 축"으로 보고
// 나머지 축을 비율대로 역산한다 - 그래야 세로로만 드래그해도 반응하고,
// 가로로만 드래그해도 반응한다. containerWidth를 모르면(초기 렌더 등) 그리드
// 단위 비율로 대충 맞추는 것도 안 하고 그냥 원래 값을 돌려준다 - 잘못된
// containerWidth=0 기준으로 계산하면 오히려 더 틀어진다.
export function lockAspectRatioSize(type, containerWidth, oldW, oldH, newW, newH) {
  const entry = catalogEntry(type);
  if (!entry || !entry.w || !entry.h || !containerWidth) return { w: newW, h: newH };

  const colWidth = gridColWidth(containerWidth);
  const baselinePixelWidth = colWidth * entry.w + GRID_MARGIN * Math.max(0, entry.w - 1);
  const baselinePixelHeight = GRID_ROW_HEIGHT * entry.h + GRID_MARGIN * Math.max(0, entry.h - 1);
  const ratio = baselinePixelWidth / baselinePixelHeight; // 카탈로그 기준 px 비율(w/h)
  const minW = entry.minW ?? 1;
  const minH = entry.minH ?? 1;

  if (newW !== oldW) {
    const pixelWidth = colWidth * newW + GRID_MARGIN * Math.max(0, newW - 1);
    const pixelHeight = pixelWidth / ratio;
    const h = Math.max(minH, Math.round((pixelHeight + GRID_MARGIN) / (GRID_ROW_HEIGHT + GRID_MARGIN)));
    return { w: newW, h };
  }
  if (newH !== oldH) {
    const pixelHeight = GRID_ROW_HEIGHT * newH + GRID_MARGIN * Math.max(0, newH - 1);
    const pixelWidth = pixelHeight * ratio;
    const w = Math.max(minW, Math.round((pixelWidth + GRID_MARGIN) / colWidth));
    return { w, h: newH };
  }
  return { w: newW, h: newH };
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
