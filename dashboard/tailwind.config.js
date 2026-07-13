/**
 * Color tokens read from CSS custom properties (see src/index.css) so every
 * dash.* color can flip between dark (default) and light theme by toggling
 * the `.light` class on <html> — no per-component light/dark branching needed
 * for anything styled purely with Tailwind classes.
 */
function withOpacity(varName) {
  return ({ opacityValue }) =>
    opacityValue === undefined ? `rgb(var(${varName}))` : `rgb(var(${varName}) / ${opacityValue})`;
}

export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        dash: {
          bg: withOpacity("--dash-bg"), // page background
          surface: withOpacity("--dash-surface"), // card background
          surfaceAlt: withOpacity("--dash-surfaceAlt"), // nested/alt surface, borders
          mint: withOpacity("--dash-mint"), // primary accent (positive, info)
          pink: withOpacity("--dash-pink"), // secondary accent (errors, alerts)
          muted: withOpacity("--dash-muted"), // secondary text
          faint: withOpacity("--dash-faint"), // tertiary text
          fg: withOpacity("--dash-fg"), // primary text — use instead of literal text-white

          // --- additions beyond the original 10-color palette ---
          // Severity/source coding needs more distinguishable hues than the
          // 2 accent colors (mint/pink) the reference palette provides.
          critical: withOpacity("--dash-critical"), // severity: critical
          high: withOpacity("--dash-high"), // severity: high
          medium: withOpacity("--dash-medium"), // severity: medium
          live: withOpacity("--dash-live"), // live/positive status indicator
          was: withOpacity("--dash-was"), // WAS source badge (Falco reuses pink, K8s Audit reuses mint)
        },
      },
    },
  },
  plugins: [],
};
