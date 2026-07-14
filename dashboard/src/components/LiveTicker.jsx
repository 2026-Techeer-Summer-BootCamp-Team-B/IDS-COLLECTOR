import React from "react";
import { SOURCE_META } from "./badges";
import { forTheme } from "../data/theme";
import { useTheme } from "../hooks/useTheme";
import { DISPLAY_TIMEZONE } from "../lib/timezone";

// e = mapLogDoc() 결과(lib/normalizedEvent.js) — mock 시절의 attackType/blocked/
// country 필드는 실제 이벤트엔 없어서(공격 유형 분류·차단 여부·GeoIP 국가명은
// 파이프라인이 안 만듦) time/source/message/namespace·pod로만 구성한다.
function describe(e, theme) {
  const src = SOURCE_META[e.source] || { label: e.source, color: "#8890B5" };
  const time = e.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: DISPLAY_TIMEZONE });
  return { time, src: { ...src, color: forTheme(src.color, theme) } };
}

// Bottom marquee of the live feed — purely cosmetic/"presence" signal, driven
// by useLiveFeed.js (real WS /ws/events stream). Renders the item list twice
// back-to-back so the CSS scroll loop (-50%) is seamless.
export default function LiveTicker({ feed }) {
  const { theme } = useTheme();
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
              const { time, src } = describe(e, theme);
              return (
                <span key={`${e.id}-${i}`} className="text-xs text-dash-muted mx-4 flex items-center gap-1.5">
                  <span className="text-dash-faint">{time}</span>
                  <span style={{ color: src.color }}>{src.label}</span>
                  <span className="text-dash-fg">{e.message}</span>
                  {e.namespace && (
                    <span className="text-dash-faint">
                      · {e.namespace}/{e.pod}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
