// Same palette as the CSS custom properties in index.css, duplicated as plain
// hex here because recharts (SVG stroke/fill props) and a few inline styles
// need literal color strings, not Tailwind classes. Keep both in sync by
// hand — if you change a value in index.css, mirror it here.
export const CHART_COLORS = {
  dark: {
    // 2026-07-15 피드백: 배경이 살짝 남색(블루 틴트)이 껴있어서 "찐한 블랙"으로
    // 안 느껴진다는 지적 - R/G/B를 거의 동일하게(중립 무채색) 낮춰서 순수 블랙에
    // 가깝게 조정. mint는 index.css의 --dash-mint(0 255 166 = #00FFA6, Tailwind
    // 클래스들이 실제로 쓰는 값)와 그동안 드리프트돼있던 값(#14B8A6, 더 탁한 톤)을
    // 여기서 맞춰준다 - 같은 "민트"인데 recharts(JS 값)와 텍스트(CSS 변수)가 다른
    // 톤으로 보이던 버그였음, 겸사겸사 더 네온답게.
    bg: "#030305",
    surface: "#0D0D10",
    surfaceAlt: "#16161B",
    mint: "#00FFA6",
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
    // 2026-07-15: Infrastructure 히트맵(Top 공격 대상 등)에 orange/pink를 써봤는데
    // 둘 다 "이상하다"는 피드백 - 사용자가 준 터미널 빌드 로그 스크린샷(시안/블루
    // 구조 텍스트 -> 초록 성공 텍스트) 톤을 참고해서 새로 추가한 중간 단계 색.
    info: "#22D3EE",
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
    info: "#0891B2",
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
