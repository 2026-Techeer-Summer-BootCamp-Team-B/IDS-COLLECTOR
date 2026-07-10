/** Color tokens pulled from the reference palette. Rename/adjust as you iterate. */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        dash: {
          bg: "#171821",        // page background
          surface: "#21222D",   // card background
          surfaceAlt: "#2B2B36",// nested/alt surface, borders
          mint: "#A9DFD8",      // primary accent (positive, info)
          pink: "#F2C8ED",      // secondary accent (errors, alerts)
          muted: "#87888C",     // secondary text
          faint: "#A0A0A0",     // tertiary text
          light: "#E8E8E8",     // light-mode surface (unused in dark layout)
          light2: "#D9D9D9",    // light-mode border (unused in dark layout)
 
          // --- additions beyond the original 10-color palette ---
          // Severity/source coding needs more distinguishable hues than the
          // 2 accent colors (mint/pink) the reference palette provides.
          critical: "#F2617A",  // severity: critical
          high: "#F2A65A",      // severity: high
          medium: "#E8D97A",    // severity: medium
          live: "#8FE3B0",      // live/positive status indicator
          was: "#7FB3E8",       // WAS source badge (Falco reuses pink, K8s Audit reuses mint)
        },
      },
    },
  },
  plugins: [],
};
 