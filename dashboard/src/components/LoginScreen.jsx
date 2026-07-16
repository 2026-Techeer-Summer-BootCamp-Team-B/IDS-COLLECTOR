import React, { useState } from "react";
import { Shield, User, Lock, Eye, EyeOff, ArrowRight, Moon, Sun } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../hooks/useTheme";
import NodeNetworkCanvas from "./NodeNetworkCanvas";

// 좌우 스플릿 풀블리드 로그인 화면. 색상은 대시보드 본편의 dash-* 네온 팔레트와
// 별개로 이 화면 전용 톤(다크=네이비/그린, 라이트=포레스트그린)을 쓴다 - 로그인은
// 인증 전 화면이라 "SIEM 콘솔" 톤보다 차분한 브랜드 톤을 의도적으로 분리.
const COLORS = {
  dark: {
    pageBg: "#0a0e17",
    leftBg: "#0b1019",
    rightBg: "#0e1420",
    brandName: "#e8f0ee",
    tagline: "#5dcaa5",
    logoBg: "rgba(29,158,117,0.18)",
    logoIcon: "#5dcaa5",
    formTitle: "#f2f7f5",
    formSubtitle: "#8fa39d",
    label: "#a9bab5",
    inputBg: "rgba(255,255,255,0.045)",
    inputBorder: "rgba(93,202,165,0.16)",
    inputText: "#e8f0ee",
    buttonBg: "#1d9e75",
    buttonText: "#04120d",
    securityText: "#5c6f69",
    glow: "rgba(29,158,117,0.16)",
    accent: "#5dcaa5",
  },
  light: {
    pageBg: "#eef1f4",
    leftBg: "#0f6e56",
    rightBg: "#ffffff",
    brandName: "#ffffff",
    tagline: "#9fe1cb",
    logoBg: "rgba(255,255,255,0.15)",
    logoIcon: "#ffffff",
    formTitle: "#0f2e24",
    formSubtitle: "#5a6b66",
    label: "#3f5852",
    inputBg: "rgba(15,110,86,0.04)",
    inputBorder: "rgba(15,110,86,0.16)",
    inputText: "#1a2b26",
    buttonBg: "#0f6e56",
    buttonText: "#ffffff",
    securityText: "#9aa8a3",
    glow: "rgba(255,255,255,0.13)",
    accent: "#0f6e56",
  },
};

// 우측 상단 고정이라 항상 오른쪽(폼) 패널 배경 위에 얹힌다 - 그 배경이
// 다크(#0e1420)/라이트(#ffffff)로 정반대라 하나의 반투명 스타일로는 한쪽에서
// 안 보인다(라이트에서 흰 배경 위 흰 글자). 그래서 왼쪽 브랜드 패널이 아니라
// 오른쪽 폼 패널 배경 기준으로 대비를 맞춘다.
function ThemeToggle({ theme, toggleTheme, c }) {
  const isLight = theme === "light";
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isLight ? "다크 모드로 전환" : "라이트 모드로 전환"}
      title={isLight ? "다크 모드로 전환" : "라이트 모드로 전환"}
      className="absolute top-5 right-5 z-20 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium backdrop-blur-sm transition-colors"
      style={{
        backgroundColor: isLight ? "rgba(15,110,86,0.08)" : "rgba(255,255,255,0.1)",
        color: isLight ? c.formTitle : c.brandName,
        border: `1px solid ${isLight ? "rgba(15,110,86,0.2)" : "rgba(255,255,255,0.16)"}`,
      }}
    >
      {isLight ? <Sun size={13} /> : <Moon size={13} />}
      {isLight ? "Light" : "Dark"}
    </button>
  );
}

function FieldWrapper({ children, c, focused }) {
  return (
    <div
      className="relative flex items-center rounded-[10px] transition-colors"
      style={{
        height: 46,
        backgroundColor: c.inputBg,
        border: `1px solid ${focused ? c.accent : c.inputBorder}`,
        boxShadow: focused ? `0 0 0 3px ${c.accent}26` : "none",
      }}
    >
      {children}
    </div>
  );
}

// servers/platform-api/app/auth.py 기준 — users 테이블(pgcrypto) 실사용자 로그인.
// 초기 관리자 계정은 postgres init/005-seed-admin-user.sh가
// ADMIN_INITIAL_PASSWORD(.env)로 시드한다 - 화면에 기본 자격증명을 노출하지 않는다.
export default function LoginScreen() {
  const { login, error } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState(null);

  const c = COLORS[theme] || COLORS.dark;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!username || !password || submitting) return;
    setSubmitting(true);
    await login(username, password);
    setSubmitting(false);
  }

  return (
    <div
      className="relative min-h-screen w-full flex overflow-hidden font-sans"
      style={{ backgroundColor: c.pageBg }}
    >
      <ThemeToggle theme={theme} toggleTheme={toggleTheme} c={c} />

      {/* 왼쪽 브랜드 패널 - 모바일에선 숨김 */}
      <div
        className="hidden md:flex relative flex-1 items-center justify-center overflow-hidden"
        style={{ backgroundColor: c.leftBg }}
      >
        <div
          className="absolute inset-0"
          style={{ background: `radial-gradient(circle at 50% 50%, ${c.glow}, transparent 60%)` }}
        />
        <NodeNetworkCanvas theme={theme} />

        <div className="relative z-10 flex flex-col items-center gap-4 px-6">
          <div
            className="flex items-center justify-center rounded-2xl"
            style={{ width: 60, height: 60, backgroundColor: c.logoBg }}
          >
            <Shield size={32} color={c.logoIcon} strokeWidth={1.75} />
          </div>
          <p style={{ color: c.brandName, fontSize: 22, fontWeight: 500, letterSpacing: "0.06em" }}>
            SENTINEL-OPS
          </p>
          <p style={{ color: c.tagline, fontSize: 12, fontWeight: 500, letterSpacing: "0.14em" }}>
            TRIPLE-GUARD PLATFORM
          </p>
        </div>
      </div>

      {/* 오른쪽 로그인 폼 패널 */}
      <div
        className="flex-1 md:flex-[0.82] flex items-center justify-center px-6"
        style={{ backgroundColor: c.rightBg }}
      >
        <div className="w-full" style={{ maxWidth: 310 }}>
          <h1 style={{ color: c.formTitle, fontSize: 21, fontWeight: 500 }}>로그인</h1>
          <p style={{ color: c.formSubtitle, fontSize: 13 }} className="mt-1.5 mb-7">
            계정 정보를 입력하세요.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label
                htmlFor="login-username"
                className="block mb-1.5"
                style={{ color: c.label, fontSize: 12, fontWeight: 500 }}
              >
                아이디
              </label>
              <FieldWrapper c={c} focused={focusedField === "username"}>
                <User size={17} style={{ color: c.inputText, opacity: 0.55, marginLeft: 13, flexShrink: 0 }} />
                <input
                  id="login-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onFocus={() => setFocusedField("username")}
                  onBlur={() => setFocusedField(null)}
                  autoFocus
                  autoComplete="username"
                  className="w-full h-full bg-transparent outline-none border-none text-sm"
                  style={{ color: c.inputText, padding: "0 13px" }}
                />
              </FieldWrapper>
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block mb-1.5"
                style={{ color: c.label, fontSize: 12, fontWeight: 500 }}
              >
                비밀번호
              </label>
              <FieldWrapper c={c} focused={focusedField === "password"}>
                <Lock size={17} style={{ color: c.inputText, opacity: 0.55, marginLeft: 13, flexShrink: 0 }} />
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocusedField("password")}
                  onBlur={() => setFocusedField(null)}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full h-full bg-transparent outline-none border-none text-sm"
                  style={{ color: c.inputText, padding: "0 13px" }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 표시"}
                  className="flex items-center justify-center shrink-0"
                  style={{ color: c.inputText, opacity: 0.55, marginRight: 13 }}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </FieldWrapper>
            </div>

            {error && (
              <div
                className="text-xs rounded-[10px] px-3 py-2.5"
                style={{ color: "#ff8a9a", backgroundColor: "rgba(255,31,75,0.1)", border: "1px solid rgba(255,31,75,0.25)" }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!username || !password || submitting}
              className="w-full flex items-center justify-center gap-1.5 rounded-[10px] text-sm transition-transform active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
              style={{ height: 47, backgroundColor: c.buttonBg, color: c.buttonText, fontWeight: 500 }}
            >
              {submitting ? (
                "로그인 중..."
              ) : (
                <>
                  로그인
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          <div
            className="flex items-center justify-center gap-1.5 mt-8"
            style={{ color: c.securityText, fontSize: 11 }}
          >
            <Lock size={12} />
            <span>인가된 사용자 전용</span>
          </div>
        </div>
      </div>
    </div>
  );
}
