import { useEffect, useRef, useState } from "react";
import { ATTACK_EVENTS } from "./attackEvents";
 
/**
 * Simulates a live event stream by replaying ATTACK_EVENTS on an interval
 * (re-stamped with the current time so it reads as "just happened"). This is
 * what powers both the bottom ticker and the CRITICAL popup.
 *
 * Real-data integration note: swap the setInterval body for a WebSocket/SSE
 * subscription — keep returning `{ feed, lastCritical }` in the same shape
 * (feed = newest-first array, lastCritical = single event object that
 * changes identity on every new critical hit) and neither consumer changes.
 */
export function useLiveAttackFeed({ intervalMs = 4000, feedLimit = 40 } = {}) {
  const [feed, setFeed] = useState(() => ATTACK_EVENTS.slice(0, 12));
  const [lastCritical, setLastCritical] = useState(null);
  const cursorRef = useRef(12);
 
  useEffect(() => {
    const timer = setInterval(() => {
      const idx = cursorRef.current % ATTACK_EVENTS.length;
      cursorRef.current += 1;
      const base = ATTACK_EVENTS[idx];
      const event = { ...base, timestamp: new Date(), _liveId: `${base.id}-${Date.now()}` };
 
      setFeed((prev) => [event, ...prev].slice(0, feedLimit));
      if (event.severity === "CRITICAL") {
        setLastCritical(event);
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, feedLimit]);
 
  return { feed, lastCritical };
}