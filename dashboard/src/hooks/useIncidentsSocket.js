import { useEffect, useRef } from "react";
import { fetchIncidentChanges } from "../lib/authApi";
import { useTabActive } from "../context/TabActivityContext";
const POLL_INTERVAL_MS = 5000;
export function useIncidentsSocket(initialWatermark, onChanges) {
  const active = useTabActive();
  const handlerRef = useRef(onChanges); handlerRef.current = onChanges;
  const watermarkRef = useRef(null);
  useEffect(() => {
    // The initial list owns the first snapshot. Starting `/changes` without a
    // watermark makes the server cursor through the entire incident history.
    if (!active || !initialWatermark) return undefined;
    let stopped = false;
    let inFlight = false;
    watermarkRef.current = initialWatermark;
    async function poll() {
      if (stopped || document.hidden || inFlight) return;
      inFlight = true;
      let cursor = null; let nextSince = null;
      try {
        do {
          const page = await fetchIncidentChanges({ since: watermarkRef.current, cursor });
          if (page.data.length) handlerRef.current?.(page.data);
          cursor = page.nextCursor;
          if (
            page.nextSince &&
            (!nextSince || new Date(page.nextSince) < new Date(nextSince))
          ) {
            nextSince = page.nextSince;
          }
        } while (cursor && !stopped);
        if (!stopped && nextSince) watermarkRef.current = nextSince;
      } finally {
        inFlight = false;
      }
    }
    const safePoll = () => poll().catch(() => {}); safePoll();
    const timer = setInterval(safePoll, POLL_INTERVAL_MS);
    const visibility = () => { if (!document.hidden) safePoll(); };
    document.addEventListener("visibilitychange", visibility);
    return () => { stopped = true; clearInterval(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [active, initialWatermark]);
}
