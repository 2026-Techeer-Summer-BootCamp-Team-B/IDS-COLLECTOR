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
    // 2026-07-17 피드백: 위 critical/high/medium/low/live를 톤다운했더니 차트
    // 전체가 칙칙해졌다는 지적 - 채도를 죽이는 대신 카드 배경(surface)을 순백에서
    // 살짝 낮춰서 네온 색과의 눈부심/대비를 줄이는 쪽으로 방향 전환. surface만
    // FFFFFF -> F7F8FC로, 색상 자체는 다시 dark와 동일한 풀채도로 되돌림.
    bg: "#F4F5FA",
    surface: "#F7F8FC",
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

// 2026-07-17 피드백: 라이트 모드 배경/카드는 밝아졌는데 이 팔레트는 다크/라이트
// 공용 고정값이라 차트만 안 밝아진 것처럼 보인다는 지적. 처음엔 흰색 쪽으로 RGB를
// 섞어(lerp) 밝혔는데, 이 방식은 채도까지 같이 죽여서 "더 칙칙해 보인다"는 반대
// 피드백을 받음 - RGB lerp-to-white는 명도(L)와 채도(S)가 함께 떨어지기 때문.
// HSL로 바꿔 L만 올리고 S는 오히려 올려서(진하게) 파스텔이 아니라 흰 배경 위에서도
// 또렷한 톤이 되도록 한다. donutPalette(theme)로 접근할 것 - DONUT_PALETTE를 직접
// 인덱싱하면 다크 톤 그대로 나온다.
function hexToHsl(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: s * 100, l: l * 100 };
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function vivid(hex, { addLightness = 8, satMultiplier = 1.35, maxSat = 88, maxLightness = 62 } = {}) {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h, Math.min(maxSat, s * satMultiplier), Math.min(maxLightness, l + addLightness));
}

export const DONUT_PALETTE_LIGHT = DONUT_PALETTE.map((hex) => vivid(hex));

export function donutPalette(theme) {
  return theme === "light" ? DONUT_PALETTE_LIGHT : DONUT_PALETTE;
}

// logLevels.js (9 levels) and attackEvents.js (9 attack types) each define
// their own larger per-category palettes as pastel/neon hex tuned for the
// dark background. Full no-op (both themes identical) turned out too bright
// on a white card, so light theme gets a light touch-up — just enough to
// cut the neon glare, nowhere near the old 40% darken that made colors
// diverge from dark mode. Dark mode is always returned untouched.
// 차트 툴팁(Pie/Bar/Area 공통) 스타일 - 예전엔 파일마다 contentStyle만 따로
// 정의했는데(LogDashboard.jsx/IncidentsView.jsx/SearchDiscoverView.jsx 각각),
// Recharts는 contentStyle이 툴팁 박스(배경/테두리)만 스타일링하고 안의 라벨/항목
// 텍스트는 itemStyle/labelStyle을 따로 안 주면 시리즈 자체 색이나 브라우저
// 기본값으로 떨어진다 - 배경과 우연히 같은 계열이 되면(예: 다크 배경 + 검정
// 텍스트) 글자가 안 보이는 문제가 있었다(2026-07-16). 셋 다 명시해서 항상
// C.fg로 대비를 보장하고, 한 군데로 모아서 세 파일이 어긋나지 않게 한다.
export function chartTooltipProps(C) {
  const style = { background: C.surfaceAlt, border: "none", borderRadius: 8, color: C.fg, fontSize: 12 };
  return { contentStyle: style, itemStyle: { color: C.fg }, labelStyle: { color: C.fg } };
}

export function forTheme(hex, theme, amount = 0.15) {
  if (theme !== "light" || !hex) return hex;
  const n = parseInt(hex.replace("#", ""), 16);
  const channel = (shift) => Math.round((((n >> shift) & 255) * (1 - amount)));
  const toHex = (c) => c.toString(16).padStart(2, "0");
  return `#${toHex(channel(16))}${toHex(channel(8))}${toHex(channel(0))}`;
}
