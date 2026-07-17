import React, { useState } from "react";
import { CHART_COLORS } from "../data/theme";
import { useTheme } from "../hooks/useTheme";
import { WORLD_COUNTRIES } from "../data/worldCountries";
import { HoverPanel } from "./HoverPanel";
import { countryToFlagEmoji } from "../lib/flagEmoji";

/**
 * Real-world map (Natural Earth 110m country outlines, see
 * data/worldCountries.js) for GeoIP visualization — dependency-free at
 * runtime since the TopoJSON was decoded + projected offline ahead of time
 * instead of pulling in react-simple-maps/d3-geo/topojson-client.
 *
 * points는 도시 단위(같은 국가에 여러 점 가능) - key는 country만으로는 충돌하므로
 * lat/lon까지 합쳐 만든다.
 */

const WIDTH = 1000;
const HEIGHT = 460;

function project(lat, lon) {
  const x = ((lon + 180) / 360) * WIDTH;
  const y = ((90 - lat) / 180) * HEIGHT;
  return { x, y };
}

export default function WorldMap({ points, compact = false }) {
  const { theme } = useTheme();
  const C = CHART_COLORS[theme];
  const maxCount = Math.max(...points.map((p) => p.count), 1);
  const [hover, setHover] = useState(null); // { point, x, y }

  return (
    <div className="relative w-full h-full">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-full">
        {WORLD_COUNTRIES.map((c) => (
          <path key={c.id || c.name} d={c.d} fill={C.surfaceAlt} stroke={C.bg} strokeWidth="0.6" />
        ))}
        {points.map((p) => {
          const { x, y } = project(p.lat, p.lon);
          const r = (compact ? 3 : 4) + (p.count / maxCount) * (compact ? 10 : 16);
          return (
            <g
              key={`${p.country}-${p.lat}-${p.lon}`}
              onMouseEnter={() => setHover({ point: p, x, y })}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: "pointer" }}
            >
              <circle cx={x} cy={y} r={r} fill={C.critical} fillOpacity="0.22" />
              <circle cx={x} cy={y} r={Math.max(2.5, r * 0.4)} fill={C.critical} />
              {/* 마커 자체(위 두 원)는 그대로 두고, 감지 반경만 널널하게 넓히는
                  투명 히트 영역 - 마커 시각 크기와 hover 인식 범위를 분리한다
                  (2026-07-17 요청). */}
              <circle cx={x} cy={y} r={r + 8} fill="transparent" pointerEvents="all" />
            </g>
          );
        })}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute z-10"
          style={{
            left: `${(hover.x / WIDTH) * 100}%`,
            top: `${(hover.y / HEIGHT) * 100}%`,
            transform: "translate(-50%, -130%)",
          }}
        >
          <HoverPanel
            title={hover.point.country}
            titleFlag={countryToFlagEmoji(hover.point.countryCode, hover.point.country)}
            subtitle={hover.point.city || undefined}
            rows={[{ color: C.critical, value: `${hover.point.count}건`, label: "탐지" }]}
          />
        </div>
      )}
    </div>
  );
}
