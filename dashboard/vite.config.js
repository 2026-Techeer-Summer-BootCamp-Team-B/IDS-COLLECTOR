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
    // 브라우저가 vite dev 서버(5173)까지만 열려있고 Traefik(80)은 못 여는
    // 환경(포트포워딩/터널이 5173 하나만 돼있는 경우)에서도 API가 되도록,
    // /api 요청을 서버 사이드(vite 프로세스 - 이 샌드박스 안)에서 대신
    // Traefik으로 프록시한다. 이러면 .env의 VITE_API_BASE_URL도 상대경로
    // "/api"로 통일 가능 - 도커로 빌드된 버전(dashboard/Dockerfile 참고)과
    // 동작이 같아진다.
    proxy: {
      "/api": {
        target: "http://localhost",
        changeOrigin: true,
      },
    },
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
