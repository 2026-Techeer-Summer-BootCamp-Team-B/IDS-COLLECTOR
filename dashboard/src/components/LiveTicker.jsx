import React from "react";
import { SOURCE_META } from "./badges";
import { ATTACK_TYPES } from "../data/attackEvents";

function describe(e) {
  const type = ATTACK_TYPES.find((t) => t.key === e.attackType);
  const src = SOURCE_META[e.source] || { label: e.source, color: "#87888C" };
  const time = e.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return { time, type, src };
}

// Bottom marquee of the live feed — purely cosmetic/"presence" signal, driven
// by useLiveFeed.js. Renders the item list twice back-to-back so the CSS
// scroll loop (-50%) is seamless.
export default function LiveTicker({ feed }) {
  const items = feed.slice(0, 20);
  if (items.length === 0) return null;

  return (
    <div className="border-t border-dash-surfaceAlt bg-dash-bg overflow-hidden shrink-0">
      <style>{`
        @keyframes ticker-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .ticker-track { animation: ticker-scroll 45s linear infinite; }
      `}</style>
      <div className="flex items-center gap-3 px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold text-dash-mint whitespace-nowrap pr-3 border-r border-dash-surfaceAlt shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-dash-mint inline-block animate-pulse" /> LIVE
        </span>
        <div className="overflow-hidden flex-1 min-w-0">
          <div className="flex whitespace-nowrap ticker-track w-max">
            {[...items, ...items].map((e, i) => {
              const { time, type, src } = describe(e);
              return (
                <span
                  key={`${e._liveId || e.id}-${i}`}
                  className="text-xs text-dash-muted mx-4 flex items-center gap-1.5"
                >
                  <span className="text-dash-faint">{time}</span>
                  <span style={{ color: src.color }}>{src.label}</span>
                  <span className="text-white">{type?.label}</span>
                  <span className="text-dash-faint">
                    · {e.namespace}/{e.pod}
                  </span>
                  <span
                    className={`ml-1 text-[10px] px-1.5 py-0.5 rounded ${
                      e.blocked ? "bg-dash-mint/15 text-dash-mint" : "bg-dash-pink/15 text-dash-pink"
                    }`}
                  >
                    {e.action}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
