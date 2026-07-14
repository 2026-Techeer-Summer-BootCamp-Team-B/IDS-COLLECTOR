import React, { createContext, useContext, useState, useCallback } from "react";
import { LIVE_POLL_MS } from "../data/timeSeries";

const STORAGE_KEY = "sentinelops_poll_interval_ms";

// 실시간 갱신 주기(폴링 간격)를 관리자가 Admin 페이지에서 커스텀할 수 있게
// 만든 전역 상태. 예전엔 data/timeSeries.js의 LIVE_POLL_MS 상수를 여러 뷰/훅이
// 그대로 import해서 고정값(2초)으로만 썼는데, 그 값을 여기 Context의 state로
// 옮기고 각 사용처는 usePollInterval()로 "지금 값"을 구독하도록 바꿨다 —
// 관리자가 설정을 바꾸면 재배포 없이 모든 실시간 패널(Overview/WAS/Falco/
// K8sAudit + LiveTicker)이 즉시 새 간격으로 갱신된다.
//
// localStorage에 저장하는 이유: 백엔드에 이 설정을 저장할 테이블/엔드포인트가
// 아직 없어서(다른 관리 설정과 달리 "화면 갱신 빈도"는 서버 상태가 아니라
// 클라이언트 표시 설정에 가까움) 브라우저별로 기억해두는 걸로 충분하다고 판단.
// 여러 관리자가 같은 값을 공유해야 하면 나중에 /settings 같은 API로 옮기면 됨.
function loadInitial() {
  if (typeof window === "undefined") return LIVE_POLL_MS;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : LIVE_POLL_MS;
}

const PollIntervalContext = createContext(null);

export function PollIntervalProvider({ children }) {
  const [pollMs, setPollMsState] = useState(loadInitial);

  const setPollMs = useCallback((ms) => {
    const next = Number(ms);
    if (!Number.isFinite(next) || next <= 0) return;
    setPollMsState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // localStorage 접근 불가(사파리 프라이빗 모드 등)해도 state는 이미
      // 바뀌었으니 이번 세션 안에서는 정상 동작 - 조용히 무시.
    }
  }, []);

  return (
    <PollIntervalContext.Provider value={{ pollMs, setPollMs, defaultPollMs: LIVE_POLL_MS }}>
      {children}
    </PollIntervalContext.Provider>
  );
}

export function usePollInterval() {
  const ctx = useContext(PollIntervalContext);
  if (!ctx) {
    // Provider 밖에서 실수로 호출된 경우에도 앱이 죽지 않도록 기본값으로 폴백.
    return { pollMs: LIVE_POLL_MS, setPollMs: () => {}, defaultPollMs: LIVE_POLL_MS };
  }
  return ctx;
}
