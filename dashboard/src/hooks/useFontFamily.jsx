import React, { createContext, useContext, useEffect, useState } from "react";

// 2026-07-16: 글씨체를 직접 골라볼 수 있게 - useTheme.jsx의 STORAGE_KEY/Provider
// 패턴을 그대로 따른다. 실제 폰트 로딩(Google Fonts/Pretendard CDN <link>)은
// index.html에서 처리하고, 여기서는 선택된 폰트의 CSS font-family 값을
// document.documentElement의 CSS 커스텀 프로퍼티(--dash-font)로 바꿔 index.css의
// `body { font-family: var(--dash-font); }`가 그걸 그대로 쓰게 한다.
const STORAGE_KEY = "sentinel-ops-font";

// value는 실제 CSS font-family 문자열 - Pretendard/Noto Sans KR처럼 한글
// 글리프가 필요한 폰트는 뒤에 sans-serif 폴백을 붙여 미로딩 상태에서도 안전하게.
export const FONT_OPTIONS = [
  { key: "system", label: "시스템 기본", value: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { key: "pretendard", label: "Pretendard", value: '"Pretendard", -apple-system, sans-serif' },
  { key: "inter", label: "Inter", value: '"Inter", -apple-system, sans-serif' },
  { key: "noto-kr", label: "Noto Sans KR", value: '"Noto Sans KR", -apple-system, sans-serif' },
  { key: "ibm-plex", label: "IBM Plex Sans", value: '"IBM Plex Sans", "IBM Plex Sans KR", -apple-system, sans-serif' },
];

const FontFamilyContext = createContext(null);

function getInitialFont() {
  if (typeof window === "undefined") return "system";
  const saved = localStorage.getItem(STORAGE_KEY);
  return FONT_OPTIONS.some((f) => f.key === saved) ? saved : "system";
}

export function FontFamilyProvider({ children }) {
  const [fontKey, setFontKey] = useState(getInitialFont);

  useEffect(() => {
    const opt = FONT_OPTIONS.find((f) => f.key === fontKey) || FONT_OPTIONS[0];
    document.documentElement.style.setProperty("--dash-font", opt.value);
    localStorage.setItem(STORAGE_KEY, fontKey);
  }, [fontKey]);

  return <FontFamilyContext.Provider value={{ fontKey, setFontKey }}>{children}</FontFamilyContext.Provider>;
}

export function useFontFamily() {
  const ctx = useContext(FontFamilyContext);
  if (!ctx) throw new Error("useFontFamily must be used inside <FontFamilyProvider>");
  return ctx;
}
