import React, { createContext, useContext, useCallback, useState } from "react";

// Overview 페이지 "사용자 모드"(위젯 드래그 이동 + 마우스 리사이즈) 상태.
// v1 범위: 배치/크기 커스텀만 - 위젯이 보여주는 차트 종류(선/막대/도넛) 변경은
// 여기 포함하지 않는다(다음 버전에서 위젯별 "표시 방식" 필드를 추가할 계획).
//
// mode: "default"(기존 고정 레이아웃, 지금까지의 Overview 그대로) | "custom"(자유
// 배치 그리드). 기본모드는 지금 JSX를 한 글자도 안 바꾸고 그대로 두므로 이 기능이
// 잘못돼도 "기본 모드로 되돌리기"만 하면 항상 예전 화면으로 복구된다 - 위험을
// 격리하는 게 이 토글 구조의 핵심 목적.
//
// layout: react-grid-layout이 쓰는 {i, x, y, w, h}[] 배열. 위젯 id(i)별 그리드
// 좌표/크기 - WIDGET_IDS(LogDashboard.jsx)와 반드시 짝이 맞아야 한다.
const STORAGE_MODE_KEY = "sentinelops_overview_mode";
const STORAGE_LAYOUT_KEY = "sentinelops_overview_layout_v1";

export const DEFAULT_OVERVIEW_LAYOUT = [
  // Row 1 - KPI 카드 4개 (기본모드의 flex-wrap 행과 동일한 순서)
  { i: "kpi-total", x: 0, y: 0, w: 3, h: 3 },
  { i: "kpi-errors", x: 3, y: 0, w: 3, h: 3 },
  { i: "kpi-warnings", x: 6, y: 0, w: 3, h: 3 },
  { i: "kpi-sources", x: 9, y: 0, w: 3, h: 3 },
  // Row 2 - 로그 개요 (막대 8 : 4)
  { i: "log-volume", x: 0, y: 3, w: 8, h: 9 },
  { i: "level-distribution", x: 8, y: 3, w: 4, h: 9 },
  // Row 3 - 보안 탐지 요약 도넛 3개
  { i: "donut-source", x: 0, y: 12, w: 4, h: 9 },
  { i: "donut-severity", x: 4, y: 12, w: 4, h: 9 },
  { i: "donut-k8s-namespace", x: 8, y: 12, w: 4, h: 9 },
  // Row 4 - API Latency
  { i: "latency-stats", x: 0, y: 21, w: 12, h: 5 },
  // Row 5 - Recent Logs(8) + Top Sources/Error Rate(4)
  { i: "recent-logs", x: 0, y: 26, w: 8, h: 14 },
  { i: "top-sources", x: 8, y: 26, w: 4, h: 7 },
  { i: "error-rate", x: 8, y: 33, w: 4, h: 7 },
  // Row 6 - Geo 지도
  { i: "geo-summary", x: 0, y: 40, w: 12, h: 11 },
];

function loadMode() {
  if (typeof window === "undefined") return "default";
  return window.localStorage.getItem(STORAGE_MODE_KEY) === "custom" ? "custom" : "default";
}

function loadLayout() {
  if (typeof window === "undefined") return DEFAULT_OVERVIEW_LAYOUT;
  try {
    const raw = window.localStorage.getItem(STORAGE_LAYOUT_KEY);
    if (!raw) return DEFAULT_OVERVIEW_LAYOUT;
    const parsed = JSON.parse(raw);
    // 저장된 레이아웃이 지금 위젯 목록과 다르면(위젯이 새로 추가/제거된 배포
    // 직후 등) 부분적으로 깨진 화면 대신 기본 레이아웃으로 안전하게 폴백.
    const ids = new Set(parsed.map((it) => it.i));
    const stillMatches = DEFAULT_OVERVIEW_LAYOUT.every((it) => ids.has(it.i));
    return stillMatches ? parsed : DEFAULT_OVERVIEW_LAYOUT;
  } catch {
    return DEFAULT_OVERVIEW_LAYOUT;
  }
}

const OverviewLayoutContext = createContext(null);

export function OverviewLayoutProvider({ children }) {
  const [mode, setModeState] = useState(loadMode);
  const [layout, setLayoutState] = useState(loadLayout);

  const setMode = useCallback((next) => {
    setModeState(next);
    try {
      window.localStorage.setItem(STORAGE_MODE_KEY, next);
    } catch {
      // 무시 - 이번 세션 안에서는 state만으로 정상 동작
    }
  }, []);

  const setLayout = useCallback((next) => {
    setLayoutState(next);
    try {
      window.localStorage.setItem(STORAGE_LAYOUT_KEY, JSON.stringify(next));
    } catch {
      // 무시
    }
  }, []);

  const resetLayout = useCallback(() => {
    setLayout(DEFAULT_OVERVIEW_LAYOUT);
  }, [setLayout]);

  return (
    <OverviewLayoutContext.Provider value={{ mode, setMode, layout, setLayout, resetLayout }}>
      {children}
    </OverviewLayoutContext.Provider>
  );
}

export function useOverviewLayout() {
  const ctx = useContext(OverviewLayoutContext);
  if (!ctx) {
    return {
      mode: "default",
      setMode: () => {},
      layout: DEFAULT_OVERVIEW_LAYOUT,
      setLayout: () => {},
      resetLayout: () => {},
    };
  }
  return ctx;
}
