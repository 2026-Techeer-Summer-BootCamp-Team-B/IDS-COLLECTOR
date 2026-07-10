import React from "react";

/**
 * Lightweight, dependency-free world map for GeoIP visualization.
 *
 * The continent shapes below are stylized blobs, not accurate coastlines —
 * this is a first-pass placeholder so you get a map without adding a new
 * dependency. When you're ready for accurate borders, swap this component
 * for `react-simple-maps` + `d3-geo` (or a real Grafana Geomap panel) and
 * keep the same `points: [{ country, lat, lon, count }]` prop shape.
 */

const WIDTH = 1000;
const HEIGHT = 460;

function project(lat, lon) {
  const x = ((lon + 180) / 360) * WIDTH;
  const y = ((90 - lat) / 180) * HEIGHT;
  return { x, y };
}

// Rough continent silhouettes, just enough to give markers spatial context.
const CONTINENTS = [
  "M120,90 C180,60 260,70 290,110 C310,150 300,200 260,230 C220,260 160,250 130,210 C100,170 90,120 120,90 Z",
  "M240,270 C270,260 300,280 300,330 C300,380 280,430 250,440 C220,430 210,380 215,330 C218,300 225,280 240,270 Z",
  "M470,80 C510,65 555,75 565,105 C575,130 555,150 520,150 C495,150 470,135 465,110 C463,100 465,88 470,80 Z",
  "M470,160 C520,150 565,170 570,220 C575,280 555,340 520,370 C490,340 470,290 465,240 C462,210 465,180 470,160 Z",
  "M580,60 C660,45 780,55 860,90 C900,115 890,160 850,180 C800,205 720,200 660,190 C610,180 585,150 580,120 C577,100 578,80 580,60 Z",
  "M790,330 C830,320 870,330 880,360 C888,385 865,405 830,405 C800,405 780,390 780,365 C780,352 783,340 790,330 Z",
];

export default function WorldMap({ points }) {
  const maxCount = Math.max(...points.map((p) => p.count), 1);

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-full">
      {CONTINENTS.map((d, i) => (
        <path key={i} d={d} fill="#2B2B36" stroke="#171821" strokeWidth="1" />
      ))}
      {points.map((p) => {
        const { x, y } = project(p.lat, p.lon);
        const r = 4 + (p.count / maxCount) * 16;
        return (
          <g key={p.country}>
            <circle cx={x} cy={y} r={r} fill="#F2617A" fillOpacity="0.22" />
            <circle cx={x} cy={y} r={Math.max(3, r * 0.4)} fill="#F2617A" />
            <title>{`${p.country}: ${p.count}건`}</title>
          </g>
        );
      })}
    </svg>
  );
}
