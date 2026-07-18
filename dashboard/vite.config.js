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
  // react-grid-layout(커스텀 대시보드 위젯 드래그/리사이즈)가 내부적으로
  // `process.env.NODE_ENV`를 직접 참조하는데(node_modules/react-grid-layout/
  // dist/legacy.js), Vite는 webpack과 달리 클라이언트 번들에 Node의 `process`를
  // 자동으로 폴리필하지 않는다 - 그래서 위젯을 드래그/리사이즈하려고 mousedown하는
  // 순간 DraggableCore의 디버그 로그 분기(`if (process.env.NODE_ENV !== "production")`)에서
  // "process is not defined"가 즉시 throw되어 드래그/리사이즈 자체가 시작도
  // 못 하고 죽었다(2026-07-17 발견 - "커스텀 리사이즈가 막혀있다"는 증상의
  // 실제 원인). 빌드 타임에 리터럴 문자열로 치환해서 해결한다.
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development"),
  },
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
