// Same palette as the CSS custom properties in index.css, duplicated as plain
// hex here because recharts (SVG stroke/fill props) and a few inline styles
// need literal color strings, not Tailwind classes. Keep both in sync by
// hand — if you change a value in index.css, mirror it here.
export const CHART_COLORS = {
  dark: {
    bg: "#171821",
    surface: "#21222D",
    surfaceAlt: "#2B2B36",
    mint: "#A9DFD8",
    pink: "#F2C8ED",
    muted: "#87888C",
    faint: "#A0A0A0",
    fg: "#FFFFFF",
    critical: "#F2617A",
    high: "#F2A65A",
    medium: "#E8D97A",
    low: "#87888C",
    live: "#8FE3B0",
    was: "#7FB3E8",
  },
  light: {
    bg: "#F4F4F7",
    surface: "#FFFFFF",
    surfaceAlt: "#E7E7EB",
    mint: "#0F8A7A",
    pink: "#C42882",
    muted: "#64656C",
    faint: "#8A8A8E",
    fg: "#171821",
    critical: "#C82844",
    high: "#BF6414",
    medium: "#8A6C0A",
    low: "#64656C",
    live: "#158A4C",
    was: "#1E64B0",
  },
};

// logLevels.js (9 levels) and attackEvents.js (9 attack types) each define
// their own larger per-category palettes as pastel hex tuned for the dark
// background — full-saturation pastel text has almost no contrast on a white
// card. Rather than hand-picking a light variant for all ~18 of those colors,
// darken them programmatically whenever the light theme is active; dark mode
// returns the color untouched.
export function forTheme(hex, theme, amount = 0.4) {
  if (theme !== "light" || !hex) return hex;
  const n = parseInt(hex.replace("#", ""), 16);
  const channel = (shift) => Math.round((((n >> shift) & 255) * (1 - amount)));
  const toHex = (c) => c.toString(16).padStart(2, "0");
  return `#${toHex(channel(16))}${toHex(channel(8))}${toHex(channel(0))}`;
}
