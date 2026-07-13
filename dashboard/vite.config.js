import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// jsPDF's optional `doc.html()` renderer (and fast-png, which it uses for
// PNG image embedding) pull in these packages — we only use jsPDF for plain
// text/table reports (exportIncident.js), never doc.html() or addImage(), so
// they're safe to externalize instead of installing. Needs to be listed in
// BOTH places below: build.rollupOptions.external is for `vite build`
// (production bundle, uses Rollup); optimizeDeps.esbuildOptions.external is
// for `vite dev` (dependency pre-bundling, uses esbuild) — they're separate
// bundlers with separate external lists, missing either one reproduces the
// "Could not resolve" error in that mode.
const JSPDF_OPTIONAL_EXTERNALS = ["html2canvas", "canvg", "dompurify", "fast-png", "iobuffer"];

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      external: JSPDF_OPTIONAL_EXTERNALS,
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      external: JSPDF_OPTIONAL_EXTERNALS,
    },
  },
});
