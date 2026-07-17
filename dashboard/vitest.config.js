import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 임시 검증용 설정 - CriticalToastStack/IncidentsView의 focusEvent 재시도 로직을
// 실제 브라우저 없이 jsdom으로 헤드리스 검증하기 위해 추가. 검증 끝나면
// vitest.config.js + 관련 devDependencies + 테스트 파일 다같이 정리 예정.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
  },
});
