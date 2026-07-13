import React, { useState } from "react";
import { RANGE_PRESETS } from "../data/timeSeries";

/**
 * OpenSearch/Grafana-style time range dropdown — a button showing the
 * current range, opening a "Commonly used" grid of presets (1분 → 90일).
 */
export default function TimeRangePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const current = RANGE_PRESETS.find((p) => p.key === value) || RANGE_PRESETS[0];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 bg-dash-bg text-dash-fg text-sm rounded-lg px-3 py-2 hover:bg-dash-surfaceAlt whitespace-nowrap"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-dash-mint">
          <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M2 6.5h12" stroke="currentColor" strokeWidth="1.3" />
          <path d="M5 1.5v3M11 1.5v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <span>Last {current.label}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-72 bg-dash-surfaceAlt rounded-xl shadow-2xl p-4 z-40">
            <p className="text-dash-muted text-xs font-medium mb-2">Commonly used</p>
            <div className="grid grid-cols-2 gap-1.5">
              {RANGE_PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => {
                    onChange(p.key);
                    setOpen(false);
                  }}
                  className={`text-xs text-left px-2 py-1.5 rounded-md transition-colors ${
                    value === p.key ? "bg-dash-mint/15 text-dash-mint" : "text-dash-mint/80 hover:bg-dash-bg"
                  }`}
                >
                  Last {p.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
