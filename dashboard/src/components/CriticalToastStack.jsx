import React, { useCallback, useEffect, useRef, useState } from "react";
import { SOURCE_META } from "./badges";
import { forTheme } from "../data/theme";
import { useTheme } from "../hooks/useTheme";

// 화면 좌측 하단 고정 CRITICAL 알림 스택. 예전엔 App.jsx의 SidebarCriticalAlert가
// 사이드바 nav 흐름 안에 알림 1건만 꽂아뒀는데(사이드바를 접으면 같이 사라짐,
// 자동소멸도 없었음), 이제 position:fixed로 스크롤/사이드바 상태와 무관하게 항상
// 뜨고, 최근 CRITICAL 여러 건을 스택으로 보여준다.
//
// events = useLiveAttackFeed().criticalEvents(App.jsx) — 폴링 배치마다 새로 발견된
// CRITICAL을 전부(1건만이 아니라) 오래된 순서로 누적한 큐. 여기서는 지난번에
// 어디까지 큐를 소비했는지(마지막으로 처리한 id) 기억해뒀다가, 그 뒤에 새로
// 붙은 항목을 전부(한 폴링 틱에 여러 건이 몰렸어도 전부) 화면 큐에 넣고
// TOAST_LIFETIME_MS 후 소멸시키는 책임을 진다.
const MAX_TOASTS = 5;
const TOAST_LIFETIME_MS = 5000;
const EXIT_DURATION_MS = 300;

// 같은 종류의 공격(=화면에 보이는 메시지가 같음)이 짧은 시간에 몰려오면 카드를
// 새로 쌓지 않고 기존 카드의 카운트만 올린다 - 안 그러면 시나리오 하나가
// 버스트로 터질 때 스택이 전부 같은 문구로 도배된다. module까지 같이 묶는 건
// 서로 다른 소스(예: WAS 500 에러 메시지 vs K8s Audit 메시지)가 우연히 같은
// 문구를 쓸 가능성을 배제하기 위함.
function groupKeyFor(event) {
  return `${event.module}|${event.message}`;
}

export default function CriticalToastStack({ events, onInvestigate }) {
  const { theme } = useTheme();
  const [toasts, setToasts] = useState([]);
  // id -> { expireTimer, removeTimer, expireAt, remainingMs }. 상태(toasts)와 별도로
  // 타이머 자체는 ref로 관리 - setState 리듀서 안에서 setTimeout 같은 부수효과를
  // 실행하면 StrictMode의 이중호출에 취약해지는 걸 피하려는 것.
  const timersRef = useRef(new Map());
  const lastProcessedIdRef = useRef(null);
  const reducedMotionRef = useRef(
    typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );

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
            i === dupIdx ? { ...t, event: ev, count: t.count + 1, bumpToken: t.bumpToken + 1 } : t
          );
          continue;
        }
        const active = next.filter((t) => !t.exiting);
        if (active.length >= MAX_TOASTS) {
          next = next.map((t) => (t.id === active[0].id ? { ...t, exiting: "forced" } : t));
        }
        next = [...next, { id: ev.id, event: ev, exiting: null, count: 1, groupKey: key, bumpToken: 0 }];
      }
      return next;
    });
  }, [events]);

  // toasts 변화에 맞춰 타이머를 동기화한다: 새로 들어온(타이머 없는) 항목엔 TOAST_LIFETIME_MS
  // 만료 타이머를, exiting이 막 세팅된 항목엔 퇴장 애니메이션 끝난 뒤 실제
  // 배열에서 제거할 타이머를 건다. bumpToken이 지난번과 달라졌으면(같은 공격이
  // 또 와서 count가 올라간 경우) 만료 타이머를 처음부터 다시 건다 - hover로
  // 일시정지 중이었으면(expireTimer 없이 remainingMs만 있는 상태) 타이머를 새로
  // 걸지 않고 remainingMs만 꽉 채워서, mouseleave 시점에 그 값으로 재개되게 한다
  // (안 그러면 bump가 hover 일시정지를 몰래 풀어버리게 됨). 그 외 이미 타이머가
  // 걸린 항목은 안 건드려서 hover 일시정지 중인 타이머를 실수로 재설정하지 않는다.
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
      } else if (!existing) {
        const expireTimer = setTimeout(() => startExit(t.id, "expire"), TOAST_LIFETIME_MS);
        timers.set(t.id, { expireTimer, expireAt: Date.now() + TOAST_LIFETIME_MS, bumpToken: t.bumpToken });
      } else if (existing.bumpToken !== t.bumpToken) {
        const wasPaused = !existing.expireTimer && existing.remainingMs != null;
        if (existing.expireTimer) clearTimeout(existing.expireTimer);
        if (wasPaused) {
          timers.set(t.id, { ...existing, expireTimer: null, remainingMs: TOAST_LIFETIME_MS, bumpToken: t.bumpToken });
        } else {
          const expireTimer = setTimeout(() => startExit(t.id, "expire"), TOAST_LIFETIME_MS);
          timers.set(t.id, {
            ...existing,
            expireTimer,
            expireAt: Date.now() + TOAST_LIFETIME_MS,
            remainingMs: undefined,
            bumpToken: t.bumpToken,
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

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 left-5 z-50 flex flex-col gap-2 w-[200px] pointer-events-none">
      {toasts.map((t) => (
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
          onMouseEnter={() => pause(t.id)}
          onMouseLeave={() => resume(t.id)}
        />
      ))}
    </div>
  );
}

function ToastCard({ toast, theme, reducedMotion, onDismiss, onInvestigate, onMouseEnter, onMouseLeave }) {
  const [entered, setEntered] = useState(false);
  const { event, exiting, count } = toast;
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
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          className={`pointer-events-auto min-w-0 bg-dash-surface border border-dash-critical rounded-2xl shadow-2xl p-4 glow-box-critical ${contentTransform}`}
        >
          <div className="flex items-center justify-between mb-2">
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
          <p className="text-dash-muted text-xs mb-3 truncate">
            {event.namespace && `${event.namespace}/${event.pod} · `}
            {event.sourceIp && `${event.sourceIp} · `}
            <span style={{ color: forTheme(src.color, theme) }}>{src.label}</span>
          </p>
          <button
            onClick={onInvestigate}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-dash-critical/15 text-dash-critical w-full"
          >
            조사하기 →
          </button>
        </div>
      </div>
    </div>
  );
}
