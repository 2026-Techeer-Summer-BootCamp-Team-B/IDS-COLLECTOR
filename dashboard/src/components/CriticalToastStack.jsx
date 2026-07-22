import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { SOURCE_META } from "./badges";
import { forTheme } from "../data/theme";
import { useTheme } from "../hooks/useTheme";
import { fetchEventIncident, fetchIncidentTimeline } from "../lib/authApi";

// 화면 좌측 하단 고정 CRITICAL 알림 스택. 예전엔 App.jsx의 SidebarCriticalAlert가
// 사이드바 nav 흐름 안에 알림 1건만 꽂아뒀는데(사이드바를 접으면 같이 사라짐,
// 자동소멸도 없었음), 이제 position:fixed로 스크롤/사이드바 상태와 무관하게 항상
// 뜨고, 최근 CRITICAL 여러 건을 스택으로 보여준다.
//
// events = useLiveAttackFeed().criticalEvents(App.jsx) — 폴링 배치마다 새로 발견된
// CRITICAL을 전부(1건만이 아니라) 오래된 순서로 누적한 큐. 여기서는 지난번에
// 어디까지 큐를 소비했는지(마지막으로 처리한 id) 기억해뒀다가, 그 뒤에 새로
// 붙은 항목을 전부(한 폴링 틱에 여러 건이 몰렸어도 전부) 화면 큐에 넣고
// 소멸시키는 책임을 진다.
const MAX_TOASTS = 5;
const TOAST_STACK_GAP_PX = 8;
const TOAST_STACK_BOTTOM_PX = 24;
const TOAST_SAFE_GAP_PX = 16;
// 2026-07-18: "스토리라인 보기가 활성화되기 전에 알림이 사라져서 의미가 없다"는
// 피드백 - 자동소멸 기준을 고정 시간이 아니라 "스토리라인 보기 활성화 여부"로
// 바꿨다. incidentId가 아직 없으면(=인시던트로 안 묶임) FALLBACK_LIFETIME_MS
// 동안 대기하다 소멸(안 묶이는 이벤트가 화면에 무한정 쌓이는 걸 막는 안전장치),
// incidentId가 잡히면(=버튼 활성화) 그 시점부터 ACTIVATED_LIFETIME_MS 후 소멸 -
// 사용자가 활성화된 버튼을 볼 시간을 보장한다. MAX_TOASTS 강제 퇴장 로직이
// 이미 있어서, 개별 토스트 수명이 늘어나도 새 CRITICAL이 화면에 못 뜨는 일은
// 없다(가장 오래된 걸 밀어냄).
const FALLBACK_LIFETIME_MS = 15000;
const ACTIVATED_LIFETIME_MS = 2000;
const EXIT_DURATION_MS = 300;
// 카드가 떠 있는 동안 이 이벤트가 어느 인시던트로 묶였는지 짧은 주기로 확인한다
// (2026-07-17, GET /events/{event_id}/incident - idx_incident_events_event_id
// 인덱스로 정확히 답함). FALLBACK_LIFETIME_MS 안에서 자연히 몇 번 재시도되다가
// 카드가 사라지면 같이 멈춘다 - 별도 타임아웃 설계가 필요 없다.
const INCIDENT_POLL_MS = 1200;
// "스토리라인 보기" 클릭 시 바로 탭을 전환하지 않고, GET /incidents/{id}/timeline이
// 먼저 성공하는 걸 확인한 뒤 이동한다(2026-07-19 요청) - 그래야 Incidents 탭으로
// 넘어간 순간 이미 데이터가 채워진 화면이 보인다(예전엔 즉시 이동 후 그쪽 화면에서
// 따로 로딩 스피너가 떴었음). 실패하면 이 시간만큼 "다시 시도"를 보여주고 원복.
const NAV_ERROR_DISPLAY_MS = 1800;

// 같은 종류의 공격(=화면에 보이는 메시지가 같음)이 짧은 시간에 몰려오면 카드를
// 새로 쌓지 않고 기존 카드의 카운트만 올린다 - 안 그러면 시나리오 하나가
// 버스트로 터질 때 스택이 전부 같은 문구로 도배된다. module까지 같이 묶는 건
// 서로 다른 소스(예: WAS 500 에러 메시지 vs K8s Audit 메시지)가 우연히 같은
// 문구를 쓸 가능성을 배제하기 위함.
function groupKeyFor(event) {
  return `${event.module}|${event.message}`;
}

export default function CriticalToastStack({ events, onInvestigate, onGoToIncident, safeTopRef, sidebarOpen = true }) {
  const { theme } = useTheme();
  const [toasts, setToasts] = useState([]);
  // id -> { expireTimer, removeTimer, expireAt, remainingMs }. 상태(toasts)와 별도로
  // 타이머 자체는 ref로 관리 - setState 리듀서 안에서 setTimeout 같은 부수효과를
  // 실행하면 StrictMode의 이중호출에 취약해지는 걸 피하려는 것.
  const timersRef = useRef(new Map());
  const lastProcessedIdRef = useRef(null);
  // 인시던트 바인딩 폴링용 - toasts 최신 스냅샷을 ref로도 들고 있어서(폴링
  // interval을 마운트 시 한 번만 걸고, 매 tick마다 이 ref로 최신 목록을 읽음)
  // toasts가 바뀔 때마다 interval을 재생성하지 않는다(그러면 잦은 갱신에
  // 타이머가 계속 리셋되어 실제로 안 불릴 수 있음).
  const toastsRef = useRef([]);
  const incidentPollInFlightRef = useRef(new Set());
  const stackRef = useRef(null);
  const [visibleLimit, setVisibleLimit] = useState(MAX_TOASTS);
  const reducedMotionRef = useRef(
    typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );

  // 고정 5개를 그대로 쌓으면 짧은 화면에서 사이드바의 Falco/K8s API 메뉴 위로
  // 올라온다. 마지막 메뉴의 실제 하단과 각 카드의 실제 높이를 재서, 그 아래
  // 공간에 완전히 들어가는 최신 알림만 렌더한다. useLayoutEffect라서 새 알림이
  // 추가될 때도 "5개가 잠깐 메뉴를 덮었다가 줄어드는" 깜빡임 없이 그려진다.
  useLayoutEffect(() => {
    const recalculate = () => {
      const safeTop = safeTopRef?.current?.getBoundingClientRect?.().bottom;
      if (!sidebarOpen || !safeTop || typeof window === "undefined") {
        setVisibleLimit(MAX_TOASTS);
        return;
      }

      const availableHeight = window.innerHeight - safeTop - TOAST_SAFE_GAP_PX - TOAST_STACK_BOTTOM_PX;
      const cards = Array.from(stackRef.current?.querySelectorAll("[data-critical-toast-card]") || []);
      const heights = cards.map((card) => card.getBoundingClientRect().height).filter((height) => height > 0);
      // jsdom처럼 레이아웃 높이를 알 수 없는 환경은 기존 최대치로 유지한다.
      if (availableHeight <= 0 || heights.length === 0) {
        setVisibleLimit(MAX_TOASTS);
        return;
      }

      // 현재 보이는 카드 중 가장 높은 값을 기준으로 잡으면, 화면을 키울 때
      // 숨겨졌던 알림도 다시 늘릴 수 있으면서 긴 메시지 카드가 섞여도 안전하다.
      const cardHeight = Math.max(...heights);
      const count = Math.floor((availableHeight + TOAST_STACK_GAP_PX) / (cardHeight + TOAST_STACK_GAP_PX));
      setVisibleLimit(Math.min(MAX_TOASTS, Math.max(1, count)));
    };

    recalculate();
    window.addEventListener("resize", recalculate);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(recalculate);
    if (safeTopRef?.current) observer?.observe(safeTopRef.current);
    if (stackRef.current) observer?.observe(stackRef.current);
    return () => {
      window.removeEventListener("resize", recalculate);
      observer?.disconnect();
    };
  }, [toasts, safeTopRef, sidebarOpen]);

  const startExit = useCallback((id, reason) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id && !t.exiting ? { ...t, exiting: reason } : t))
    );
  }, []);

  // criticalEvents 큐에 새로 붙은 항목(지난번 처리한 마지막 id 이후)을 전부 처리한다.
  // 한 틱에 여러 건이 와도 순서대로 하나씩:
  //   - 이미 화면에 떠 있는(exiting 아닌) 같은 종류(groupKeyFor) 카드가 있으면
  //     새로 안 쌓고 그 카드의 count만 올리고 event를 최신 것으로 갱신한다
  //     (bumpToken을 올려서 타이머 동기화 effect가 만료 타이머를 리셋하게 신호).
  //   - 없으면 큐 맨 뒤(=화면 맨 아래)에 새 카드 추가, 이미 MAX_TOASTS만큼
  //     활성(exiting 아님) 상태면 가장 오래된 걸 강제 퇴장 처리.
  useEffect(() => {
    if (!events || events.length === 0) return;
    const lastIdx = lastProcessedIdRef.current
      ? events.findIndex((e) => e.id === lastProcessedIdRef.current)
      : -1;
    const newOnes = events.slice(lastIdx + 1);
    if (newOnes.length === 0) return;
    lastProcessedIdRef.current = events[events.length - 1].id;

    setToasts((prev) => {
      let next = prev;
      for (const ev of newOnes) {
        const key = groupKeyFor(ev);
        const dupIdx = next.findIndex((t) => !t.exiting && t.groupKey === key);
        if (dupIdx !== -1) {
          next = next.map((t, i) =>
            i === dupIdx
              ? { ...t, event: ev, count: t.count + 1, bumpToken: t.bumpToken + 1, incidentId: null }
              : t
          );
          continue;
        }
        const active = next.filter((t) => !t.exiting);
        if (active.length >= MAX_TOASTS) {
          next = next.map((t) => (t.id === active[0].id ? { ...t, exiting: "forced" } : t));
        }
        next = [
          ...next,
          { id: ev.id, event: ev, exiting: null, count: 1, groupKey: key, bumpToken: 0, incidentId: null },
        ];
      }
      return next;
    });
  }, [events]);

  // toasts 변화에 맞춰 타이머를 동기화한다. 목표 수명(targetMs)은 incidentId
  // 유무로 갈린다(FALLBACK_LIFETIME_MS vs ACTIVATED_LIFETIME_MS, 위 상수 설명
  // 참고) - 새로 들어온(타이머 없는) 항목엔 그 목표 수명의 만료 타이머를 건다.
  // "phase"(hadIncident)가 바뀌었거나(=방금 스토리라인이 활성화됐거나 bump로
  // 다시 비활성화됨) bumpToken이 바뀌었으면(같은 공격이 또 와서 count가 올라간
  // 경우) 타이머를 새 목표 수명으로 다시 건다 - hover로 일시정지 중이었으면
  // (expireTimer 없이 remainingMs만 있는 상태) 타이머를 새로 걸지 않고
  // remainingMs만 새 목표 수명으로 갱신해서, mouseleave 시점에 그 값으로
  // 재개되게 한다(안 그러면 활성화/bump가 hover 일시정지를 몰래 풀어버림).
  // exiting이 막 세팅된 항목엔 퇴장 애니메이션 끝난 뒤 실제 배열에서 제거할
  // 타이머를 건다.
  useEffect(() => {
    const timers = timersRef.current;
    const reduced = reducedMotionRef.current;

    for (const t of toasts) {
      const existing = timers.get(t.id);
      if (t.exiting) {
        if (!existing?.removeTimer) {
          if (existing?.expireTimer) clearTimeout(existing.expireTimer);
          const removeTimer = setTimeout(() => {
            setToasts((prev) => prev.filter((x) => x.id !== t.id));
          }, reduced ? 0 : EXIT_DURATION_MS);
          timers.set(t.id, { ...existing, expireTimer: null, removeTimer });
        }
        continue;
      }

      const hasIncident = !!t.incidentId;
      const targetMs = hasIncident ? ACTIVATED_LIFETIME_MS : FALLBACK_LIFETIME_MS;

      if (!existing) {
        const expireTimer = setTimeout(() => startExit(t.id, "expire"), targetMs);
        timers.set(t.id, {
          expireTimer,
          expireAt: Date.now() + targetMs,
          bumpToken: t.bumpToken,
          hadIncident: hasIncident,
        });
      } else if (existing.hadIncident !== hasIncident || existing.bumpToken !== t.bumpToken) {
        const wasPaused = !existing.expireTimer && existing.remainingMs != null;
        if (existing.expireTimer) clearTimeout(existing.expireTimer);
        if (wasPaused) {
          timers.set(t.id, {
            ...existing,
            expireTimer: null,
            remainingMs: targetMs,
            bumpToken: t.bumpToken,
            hadIncident: hasIncident,
          });
        } else {
          const expireTimer = setTimeout(() => startExit(t.id, "expire"), targetMs);
          timers.set(t.id, {
            ...existing,
            expireTimer,
            expireAt: Date.now() + targetMs,
            remainingMs: undefined,
            bumpToken: t.bumpToken,
            hadIncident: hasIncident,
          });
        }
      }
    }

    const liveIds = new Set(toasts.map((t) => t.id));
    for (const id of timers.keys()) {
      if (!liveIds.has(id)) timers.delete(id);
    }
  }, [toasts, startExit]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => {
        clearTimeout(t.expireTimer);
        clearTimeout(t.removeTimer);
      });
      timers.clear();
    };
  }, []);

  useEffect(() => {
    toastsRef.current = toasts;
  }, [toasts]);

  // "공격 스토리라인 보기" 활성화 여부를 위한 인시던트 바인딩 폴링. 컴포넌트
  // 마운트 시 딱 한 번 interval을 걸고(toasts 갱신마다 재생성하지 않음), 매 tick마다
  // toastsRef의 최신 목록에서 아직 안 묶인(incidentId 없음) 활성 카드만 골라 확인한다.
  useEffect(() => {
    const inFlight = incidentPollInFlightRef.current;
    const timer = setInterval(() => {
      for (const t of toastsRef.current) {
        if (t.exiting || t.incidentId || inFlight.has(t.id)) continue;
        inFlight.add(t.id);
        fetchEventIncident(t.event.id)
          .then((res) => {
            if (res?.incident_id) {
              setToasts((prev) =>
                prev.map((x) => (x.id === t.id ? { ...x, incidentId: res.incident_id } : x))
              );
            }
          })
          .catch(() => {})
          .finally(() => inFlight.delete(t.id));
      }
    }, INCIDENT_POLL_MS);
    return () => clearInterval(timer);
  }, []);

  const pause = useCallback((id) => {
    const t = timersRef.current.get(id);
    if (!t?.expireTimer) return;
    clearTimeout(t.expireTimer);
    timersRef.current.set(id, {
      ...t,
      expireTimer: null,
      remainingMs: Math.max(0, t.expireAt - Date.now()),
    });
  }, []);

  const resume = useCallback((id) => {
    const t = timersRef.current.get(id);
    if (!t || t.expireTimer || t.remainingMs == null) return;
    const remaining = t.remainingMs;
    const expireTimer = setTimeout(() => startExit(id, "expire"), remaining);
    timersRef.current.set(id, { ...t, expireTimer, expireAt: Date.now() + remaining, remainingMs: null });
  }, [startExit]);

  function dismiss(id) {
    const t = timersRef.current.get(id);
    if (t?.expireTimer) clearTimeout(t.expireTimer);
    startExit(id, "dismiss");
  }

  // "스토리라인 보기" 클릭 → GET /incidents/{id}/timeline이 실제로 데이터를 내려줄
  // 때까지 버튼을 loading 상태로 두고, 성공하면 그제서야 dismiss+탭 전환한다.
  // 실패하면 error를 잠깐(NAV_ERROR_DISPLAY_MS) 보여주고 idle로 되돌린다 - 그
  // 동안도 버튼은 그대로 눌러서 즉시 재시도할 수 있다. toasts 배열에서 이미 사라진
  // (자동소멸/닫기로 지워진) id에 대한 setToasts는 map이 그대로 통과시켜서
  // 안전하게 no-op된다.
  const setNavState = useCallback((id, navState) => {
    setToasts((prev) => prev.map((x) => (x.id === id ? { ...x, navState } : x)));
  }, []);

  const handleGoToIncident = useCallback(
    (t) => {
      if (t.navState === "loading" || !t.incidentId) return;
      setNavState(t.id, "loading");
      fetchIncidentTimeline(t.incidentId)
        .then(() => {
          dismiss(t.id);
          onGoToIncident?.(t.incidentId);
        })
        .catch(() => {
          setNavState(t.id, "error");
          setTimeout(() => setNavState(t.id, "idle"), NAV_ERROR_DISPLAY_MS);
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onGoToIncident, setNavState]
  );

  if (toasts.length === 0) return null;

  const visibleToasts = toasts.slice(-visibleLimit);

  return (
    <div ref={stackRef} className="fixed bottom-6 left-[5px] z-50 flex flex-col gap-2 w-[230px] pointer-events-none">
      {visibleToasts.map((t) => (
        <ToastCard
          key={t.id}
          toast={t}
          theme={theme}
          reducedMotion={reducedMotionRef.current}
          onDismiss={() => dismiss(t.id)}
          onInvestigate={() => {
            dismiss(t.id);
            onInvestigate?.(t.event);
          }}
          onGoToIncident={() => {
            handleGoToIncident(t);
          }}
          onMouseEnter={() => pause(t.id)}
          onMouseLeave={() => resume(t.id)}
        />
      ))}
    </div>
  );
}

function ToastCard({
  toast,
  theme,
  reducedMotion,
  onDismiss,
  onInvestigate,
  onGoToIncident,
  onMouseEnter,
  onMouseLeave,
}) {
  const [entered, setEntered] = useState(false);
  const { event, exiting, count, incidentId, navState } = toast;
  const src = SOURCE_META[event.source] || { label: event.source, color: "#8890B5" };

  // 마운트 직후 한 프레임 쉬고 entered를 true로 올려서 grid-rows/opacity 트랜지션이
  // "0 -> 값" 변화를 실제로 감지하고 재생하게 한다(동기적으로 바로 1이면 브라우저가
  // 전이할 시작점을 못 잡아 애니메이션이 생략됨 - 표준 enter-transition 패턴).
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const open = entered && !exiting;

  const rowStyle = reducedMotion
    ? { gridTemplateRows: open ? "1fr" : "0fr" }
    : { gridTemplateRows: open ? "1fr" : "0fr", transition: "grid-template-rows 300ms ease" };

  const contentTransform = reducedMotion
    ? ""
    : "transition-[opacity,transform] duration-300 " +
      (exiting === "forced"
        ? "ease-in opacity-0 -translate-y-2"
        : exiting
        ? "ease-in opacity-0"
        : entered
        ? "ease-out opacity-100 translate-y-0"
        : "ease-out opacity-0 translate-y-3");

  return (
    <div className="grid overflow-hidden min-w-0" style={rowStyle}>
      <div className="min-h-0 min-w-0">
        <div
          role="alert"
          data-critical-toast-card
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          className={`pointer-events-auto min-w-0 bg-dash-surface border border-dash-critical rounded-2xl shadow-2xl p-3 glow-box-critical ${contentTransform}`}
        >
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold tracking-wide px-1.5 py-0.5 rounded bg-dash-critical/20 text-dash-critical">
                CRITICAL
              </span>
              {count > 1 && (
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-dash-critical text-white"
                  title={`같은 공격이 ${count}번 발생`}
                >
                  ×{count}
                </span>
              )}
            </div>
            <button
              onClick={onDismiss}
              aria-label="알림 닫기"
              className="text-dash-muted hover:text-dash-fg text-xs leading-none"
            >
              ✕
            </button>
          </div>
          <p className="text-dash-fg text-sm font-medium mb-1 leading-snug line-clamp-2">{event.message}</p>
          <p className="text-dash-muted text-xs mb-2 truncate">
            {event.namespace && `${event.namespace}/${event.pod} · `}
            {event.sourceIp && `${event.sourceIp} · `}
            <span style={{ color: forTheme(src.color, theme) }}>{src.label}</span>
          </p>
          <div className="flex gap-1">
            <button
              onClick={onInvestigate}
              className="text-[11px] font-medium px-2 py-1 rounded-lg bg-dash-critical/15 text-dash-critical flex-1"
            >
              조사하기
            </button>
            <button
              onClick={onGoToIncident}
              disabled={!incidentId || navState === "loading"}
              title={incidentId ? undefined : "아직 인시던트로 묶이지 않았어요"}
              className={
                "text-[11px] font-medium px-2 py-1 rounded-lg flex-1 transition-colors flex items-center justify-center gap-1 " +
                (navState === "error"
                  ? "bg-dash-critical/15 text-dash-critical cursor-pointer"
                  : navState === "loading"
                  ? "bg-dash-mint/15 text-dash-mint cursor-not-allowed"
                  : incidentId
                  ? "bg-dash-mint/15 text-dash-mint hover:bg-dash-mint/25 cursor-pointer"
                  : "bg-dash-muted/10 text-dash-muted cursor-not-allowed")
              }
            >
              {(navState === "loading" || !incidentId) && <LoaderCircle size={12} className="animate-spin shrink-0" />}
              {navState === "loading" || !incidentId ? (
                <span>분석 중</span>
              ) : navState === "error" ? "다시 시도" : "스토리라인 보기"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
