import React, { useEffect, useState } from "react";
import { SOURCE_META } from "./badges";
import { forTheme } from "../data/theme";
import { useTheme } from "../hooks/useTheme";

// Fires whenever useLiveFeed.js reports a new CRITICAL(severity=4) event.
// event = mapLogDoc() 결과(lib/normalizedEvent.js) — mock 시절의 attackType/
// country 필드는 실제 이벤트엔 없어서 message/namespace·pod/sourceIp로 표시.
// Auto-dismisses after 6s, or the user can close it / jump to Incidents early.
export default function CriticalAlertPopup({ event, onInvestigate }) {
  const { theme } = useTheme();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!event) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(t);
  }, [event?.id]);

  if (!event || !visible) return null;

  const src = SOURCE_META[event.source] || { label: event.source, color: "#8890B5" };

  return (
    <div className="fixed top-6 right-6 z-50 w-80 bg-dash-surface border border-dash-critical rounded-2xl shadow-2xl p-4 glow-box-critical">
      <style>{`
        @keyframes critical-pop-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
      <div className="animate-[critical-pop-in_0.2s_ease-out]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold tracking-wide px-1.5 py-0.5 rounded bg-dash-critical/20 text-dash-critical">
            CRITICAL
          </span>
          <button onClick={() => setVisible(false)} className="text-dash-muted hover:text-dash-fg text-xs leading-none">
            ✕
          </button>
        </div>
        <p className="text-dash-fg text-sm font-medium mb-1">{event.message}</p>
        <p className="text-dash-muted text-xs mb-3">
          {event.namespace && `${event.namespace}/${event.pod} · `}
          {event.sourceIp && `${event.sourceIp} · `}
          <span style={{ color: forTheme(src.color, theme) }}>{src.label}</span>
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
