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
