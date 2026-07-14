// Same palette as the CSS custom properties in index.css, duplicated as plain
// hex here because recharts (SVG stroke/fill props) and a few inline styles
// need literal color strings, not Tailwind classes. Keep both in sync by
// hand — if you change a value in index.css, mirror it here.
export const CHART_COLORS = {
  dark: {
    bg: "#05060B",
    surface: "#0E0F1A",
    surfaceAlt: "#191B2C",
    mint: "#14B8A6",
    pink: "#A64DFF",
    muted: "#8890B5",
    faint: "#5A6288",
    fg: "#F2F5FF",
    critical: "#FF1F4B",
    high: "#FF7A18",
    medium: "#F5E400",
    low: "#8890B5",
    live: "#39FF6A",
    was: "#1F57FF",
  },
  light: {
    bg: "#F4F5FA",
    surface: "#FFFFFF",
    surfaceAlt: "#E6E8F5",
    mint: "#0F766E",
    pink: "#7A1FD1",
    muted: "#5B6180",
    faint: "#8388A6",
    fg: "#0B0C14",
    critical: "#FF1F4B",
    high: "#FF7A18",
    medium: "#F5E400",
    low: "#8890B5",
    live: "#39FF6A",
    was: "#1D4ED8",
  },
};

// 도넛/막대 차트의 카테고리 색상용 무채도 순환 팔레트 — 모듈/심각도별 "의미
// 있는" 고정색(MODULE_META, REAL_SEVERITY_LEVELS)과는 별개로, Overview의
// 차트 묶음(탐지 소스별/심각도/K8s 네임스페이스 도넛 + Log Levels 막대)만
// 이 톤 다운된 팔레트를 인덱스 순서로 돌려쓴다. 뱃지 등 다른 곳의 의미색은
// 그대로 유지 (예: severity 배지는 여전히 REAL_SEVERITY_LEVELS.color 사용).
export const DONUT_PALETTE = ["#C05B4D", "#D68C3E", "#5B9A5E", "#4A7FB5", "#8890B5"];

// logLevels.js (9 levels) and attackEvents.js (9 attack types) each define
// their own larger per-category palettes as pastel/neon hex tuned for the
// dark background. Full no-op (both themes identical) turned out too bright
// on a white card, so light theme gets a light touch-up — just enough to
// cut the neon glare, nowhere near the old 40% darken that made colors
// diverge from dark mode. Dark mode is always returned untouched.
export function forTheme(hex, theme, amount = 0.15) {
  if (theme !== "light" || !hex) return hex;
  const n = parseInt(hex.replace("#", ""), 16);
  const channel = (shift) => Math.round((((n >> shift) & 255) * (1 - amount)));
  const toHex = (c) => c.toString(16).padStart(2, "0");
  return `#${toHex(channel(16))}${toHex(channel(8))}${toHex(channel(0))}`;
}
