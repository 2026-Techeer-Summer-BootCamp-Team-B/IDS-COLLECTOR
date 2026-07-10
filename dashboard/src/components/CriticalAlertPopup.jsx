import React, { useEffect, useState } from "react";
import { ATTACK_TYPES } from "../data/attackEvents";
import { SOURCE_META } from "./badges";

// Fires whenever useLiveFeed.js reports a new CRITICAL event. Auto-dismisses
// after 6s, or the user can close it / jump to Incidents early.
export default function CriticalAlertPopup({ event, onInvestigate }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!event) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(t);
  }, [event?._liveId]);

  if (!event || !visible) return null;

  const type = ATTACK_TYPES.find((t) => t.key === event.attackType);
  const src = SOURCE_META[event.source] || { label: event.source, color: "#87888C" };

  return (
    <div className="fixed top-6 right-6 z-50 w-80 bg-dash-surface border border-dash-critical rounded-2xl shadow-2xl p-4">
      <style>{`
        @keyframes critical-pop-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
      <div className="animate-[critical-pop-in_0.2s_ease-out]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold tracking-wide px-1.5 py-0.5 rounded bg-dash-critical/20 text-dash-critical">
            CRITICAL
          </span>
          <button onClick={() => setVisible(false)} className="text-dash-muted hover:text-white text-xs leading-none">
            ✕
          </button>
        </div>
        <p className="text-white text-sm font-medium mb-1">{type?.label} 탐지</p>
        <p className="text-dash-muted text-xs mb-3">
          {event.namespace}/{event.pod} · {event.sourceIp} ({event.country}) ·{" "}
          <span style={{ color: src.color }}>{src.label}</span>
        </p>
        <button
          onClick={() => {
            setVisible(false);
            onInvestigate?.();
          }}
          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-dash-critical/15 text-dash-critical w-full"
        >
          조사하기 →
        </button>
      </div>
    </div>
  );
}
