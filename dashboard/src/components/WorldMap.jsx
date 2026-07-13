import React from "react";
import { CHART_COLORS } from "../data/theme";
import { useTheme } from "../hooks/useTheme";
import { WORLD_COUNTRIES } from "../data/worldCountries";

/**
 * Real-world map (Natural Earth 110m country outlines, see
 * data/worldCountries.js) for GeoIP visualization — dependency-free at
 * runtime since the TopoJSON was decoded + projected offline ahead of time
 * instead of pulling in react-simple-maps/d3-geo/topojson-client.
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

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-full">
      {WORLD_COUNTRIES.map((c) => (
        <path key={c.id || c.name} d={c.d} fill={C.surfaceAlt} stroke={C.bg} strokeWidth="0.6" />
      ))}
      {points.map((p) => {
        const { x, y } = project(p.lat, p.lon);
        const r = (compact ? 3 : 4) + (p.count / maxCount) * (compact ? 10 : 16);
        return (
          <g key={p.country}>
            <circle cx={x} cy={y} r={r} fill={C.critical} fillOpacity="0.22" />
            <circle cx={x} cy={y} r={Math.max(2.5, r * 0.4)} fill={C.critical} />
            <title>{`${p.country}: ${p.count}건`}</title>
          </g>
        );
      })}
    </svg>
  );
}
