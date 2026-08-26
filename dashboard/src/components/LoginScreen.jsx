import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../hooks/useTheme";
import OnboardingPlayer from "./onboarding/OnboardingPlayer";

// 2026-07-16: 처음 로그인하는 사용자가 "이 대시보드에 뭐가 있지?"부터 궁금할 것
// 같다는 피드백 - App.jsx의 NAV_ITEMS/LAYER_NAV_ITEMS와 같은 5개 메인 페이지를
// 로그인 전에 소개한다. 색상은 모노크롬 컨셉(요청받은 스타일 - white/gray/black만,
// 파랑·네온 없음)이라 예전처럼 페이지별 accent 컬러는 안 쓰고 전부 흰색/회색 톤으로
// 통일했다.
//
// 2026-07-16(2차): 온보딩 카드 5개 + 그 렌더러가 전부 이 파일 안에 있던 걸
// components/onboarding/ 폴더로 분리했다("각 페이지마다 각 컴포넌트로" 요청).
// 개별 카드 내용은 components/onboarding/OverviewOnboardingCard.jsx 등을 참고.
//
// 2026-07-17(3차): "온보딩 영상을 다 봐야 로그인 창이 나오게" 요청으로,
// 5개를 스크롤로 훑어보는 OnboardingSection 대신 한 번에 하나씩 순서대로
// 이어 재생하는 OnboardingPlayer를 쓴다. OnboardingSection.jsx는 코드는
// 남아있지만 이 파일에서는 더 이상 쓰지 않는다.

// 상단 툴바의 마이크/카메라/화면공유/전체화면 아이콘 - 참고 스타일 프롬프트에
// 있던 장식용 요소라 실제 동작은 없다(로그인 화면에 화상회의 컨트롤이 있을
// 이유는 없지만, 무채색 프리미엄 SaaS 톤을 내는 장식으로만 사용).
function ToolbarIcon({ children }) {
  return <span className="w-4 h-4 text-white/60">{children}</span>;
}

// servers/platform-api/app/auth.py 기준 — users 테이블(pgcrypto) 실사용자 로그인.
// 초기 관리자 계정은 postgres init/005-seed-admin-user.sh가
// ADMIN_INITIAL_PASSWORD(.env)로 시드한다 - 화면에 기본 자격증명을 노출하지 않는다.
// 평가자가 계정 없이 전체 기능(admin 전용 쓰기 포함)을 테스트해볼 수 있도록 하는
// 공개 데모 계정 - servers/datastore/postgres/init/031-seed-demo-account.sh가
// 같은 이름/비밀번호로 role=admin 계정을 시드한다. VITE_DEMO_PASSWORD가
// 설정되지 않은 배포(주로 실서비스)에서는 아래 "로그인 없이 둘러보기" 버튼 자체가
// 렌더링되지 않는다.
const DEMO_USERNAME = "demo";
const DEMO_PASSWORD = import.meta.env.VITE_DEMO_PASSWORD;

export default function LoginScreen() {
  const { login, error } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const isLight = theme === "light";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [demoSubmitting, setDemoSubmitting] = useState(false);
  // 2026-07-16: 로고(public/logo.png)가 아직 안 올라와 있을 수도 있으니, 이미지
  // 로드가 실패하면 기존의 흰 사각 아이콘으로 조용히 대체 - 깨진 이미지 아이콘이
  // 그대로 노출되는 것보다 낫다.
  const [logoFailed, setLogoFailed] = useState(false);
  // 2026-07-17: "온보딩 영상 5개를 이어서 하나의 영상처럼 만들고, 다 시청해야
  // 로그인/회원가입 창이 나오게 해달라"는 요청 - 온보딩을 다 보기 전엔
  // onboardingDone이 false라 로그인 폼 대신 OnboardingPlayer만 보이고,
  // 마지막 영상까지 끝나면(OnboardingPlayer의 onComplete) true로 바뀌면서
  // 로그인 폼으로 전환된다. 새로고침하면 다시 처음부터 - 별도로 localStorage에
  // "이미 봤음"을 저장해두진 않았다(요청에 없던 부분이라 우선 뺐다).
  const [onboardingDone, setOnboardingDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!username || !password || submitting) return;
    setSubmitting(true);
    await login(username, password);
    setSubmitting(false);
  }

  async function handleDemoLogin() {
    if (demoSubmitting) return;
    setDemoSubmitting(true);
    await login(DEMO_USERNAME, DEMO_PASSWORD);
    setDemoSubmitting(false);
  }

  return (
    // 2026-07-16: "화면이 짤린다"는 문제의 원인 - 바깥 컨테이너에 overflow-hidden이
    // 걸려 있어서, 안쪽 콘텐츠(온보딩 카드들)가 한 화면 높이보다 커지면 페이지
    // 자체가 스크롤되지 못하고 그냥 잘려나갔다. overflow-hidden을 제거하고
    // min-h-screen만 유지 -> 콘텐츠가 넘치면 브라우저가 알아서 세로 스크롤을
    // 만든다. 대각선 배경 조각들은 absolute inset-0라 스크롤과 무관하게 항상
    // 뷰포트를 채운다.
    <div className="min-h-screen relative flex items-center justify-center px-4 py-8 bg-black">
      {/* 2026-07-16: 요청받은 스타일("모던 모노크롬 글래스모피즘, 좌 화이트/우
          매트블랙 대각선 분할, 파랑·네온 없음")대로 배경을 다시 짰다. clip-path로
          정확한 대각선 두 조각을 만들고, 어두운 쪽에만 미세한 격자 패턴을 얹어
          "사이버 그리드" 느낌을 줬다. 색은 전부 흰색/회색/검정만 사용. */}
      <div
        className="absolute inset-0"
        style={{
          clipPath: "polygon(0 0, 62% 0, 38% 100%, 0 100%)",
          background: "linear-gradient(160deg, #FFFFFF 0%, #ECEDF2 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          clipPath: "polygon(62% 0, 100% 0, 100% 100%, 38% 100%)",
          background: "linear-gradient(160deg, #131316 0%, #08080A 100%)",
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.06] pointer-events-none"
        style={{
          clipPath: "polygon(62% 0, 100% 0, 100% 100%, 38% 100%)",
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.9) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.9) 1px, transparent 1px)",
          backgroundSize: "42px 42px",
        }}
      />
      {/* 은은한 스튜디오 라이팅 - 색상 없이 흰색 bloom만 */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 45% 35% at 22% 8%, rgb(255 255 255 / 0.35), transparent), radial-gradient(ellipse 40% 30% at 82% 95%, rgb(255 255 255 / 0.08), transparent)",
        }}
      />

      {/* 우상단 장식 툴바 (비활성, 장식용) */}
      <div className="absolute top-5 right-5 hidden sm:flex items-center gap-3 bg-black/40 backdrop-blur-md border border-white/10 rounded-xl px-3.5 py-2.5 shadow-lg">
        <ToolbarIcon>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" strokeLinecap="round" />
          </svg>
        </ToolbarIcon>
        <ToolbarIcon>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <rect x="2" y="6" width="15" height="12" rx="2" />
            <path d="M17 10l5-3v10l-5-3" strokeLinejoin="round" />
          </svg>
        </ToolbarIcon>
        <ToolbarIcon>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <rect x="2" y="4" width="20" height="13" rx="2" />
            <path d="M8 21h8M12 17v4M8 9l3 3 5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </ToolbarIcon>
        <ToolbarIcon>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path
              d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </ToolbarIcon>
      </div>

      {/* 2026-07-16: 로그인 페이지는 지금까지 앱 테마(useTheme)와 무관하게 항상
          같은 모노크롬 대각선 배경을 썼다 - 이건 의도적인 브랜드 스타일이라
          그대로 두고, 대신 "로그인 후 들어갈 대시보드가 라이트/다크 중 뭘로
          보일지"를 미리 골라둘 수 있게 토글 버튼만 추가했다. App.jsx의
          ThemeToggle과 완전히 같은 아이콘/로직(useTheme)을 재사용 - 여기서
          바꾼 값이 localStorage에 저장되고 로그인 후 대시보드에도 그대로
          이어진다. */}
      <button
        type="button"
        onClick={toggleTheme}
        aria-label="라이트/다크 모드 전환"
        title={isLight ? "다크 모드로 전환" : "라이트 모드로 전환"}
        className="absolute top-5 left-5 w-9 h-9 flex items-center justify-center rounded-xl bg-black/40 backdrop-blur-md border border-white/10 text-white/70 hover:text-white shadow-lg transition-colors"
      >
        {isLight ? (
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 1.5v2M8 12.5v2M2.6 2.6l1.4 1.4M12 12l1.4 1.4M1.5 8h2M12.5 8h2M2.6 13.4l1.4-1.4M12 4l1.4-1.4"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
            <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <path
              d="M13.5 9.6A5.8 5.8 0 1 1 6.4 2.5a4.6 4.6 0 0 0 7.1 7.1Z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      {/* 우하단 반짝임 장식 */}
      <div className="absolute bottom-8 right-10 hidden sm:flex items-end gap-2.5 pointer-events-none opacity-80">
        <span className="text-white text-base leading-none">✦</span>
        <span className="text-white/60 text-xs leading-none mb-0.5">✦</span>
        <span className="text-white text-xl leading-none">✦</span>
      </div>

      {/* 2026-07-17: "온보딩 영상을 다 봐야 로그인/회원가입 창이 나오게"라는
          요청으로 구조가 다시 바뀌었다 - 이전엔 로그인 카드가 항상 위에 고정
          노출되고 그 아래 온보딩 카드 5개가 스크롤 갤러리로 같이 떠 있었지만,
          이제는 onboardingDone이 false인 동안은 OnboardingPlayer(영상을
          이어붙여 순서대로 자동재생하는 컴포넌트)만 보이고, 마지막 영상까지
          다 끝나야 로그인 카드로 화면이 바뀐다. */}
      {/* 2026-07-16: "로그인 입력창은 작아도 되니 대시보드(온보딩) 크기를
          1240x800 스케일로 크게 키워달라"는 요청 - 바깥 컬럼 폭을
          max-w-xl(576px) -> max-w-[1240px]로 크게 넓혔다. 로그인 카드가 보일
          때는 그 안에서만 max-w-sm(384px)로 좁혀서 중앙에 작게 띄운다.
          OnboardingPlayer는 넓어진 폭 전체를 그대로 쓴다. */}
      <div className="relative w-full max-w-[1240px] space-y-5">
        {!onboardingDone ? (
          <OnboardingPlayer onComplete={() => setOnboardingDone(true)} />
        ) : (
          <div className="max-w-sm mx-auto bg-black/50 backdrop-blur-xl rounded-2xl border border-white/15 shadow-2xl px-6 py-5">
            <div className="flex items-center gap-2.5 mb-4">
              {!logoFailed ? (
                <img
                  src="/logo.png"
                  alt="SENTINEL-OPS"
                  onError={() => setLogoFailed(true)}
                  className="w-11 h-11 rounded-xl object-cover shadow-lg shrink-0"
                />
              ) : (
                <div className="w-11 h-11 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center shrink-0">
                  <span className="w-4 h-4 rounded-sm bg-white" />
                </div>
              )}
              <div>
                <p className="text-white font-semibold text-base leading-none tracking-wide">SENTINEL-OPS</p>
                <p className="text-white/60 text-[11px] mt-1.5 leading-relaxed">
                  WAS · WAF · Falco · K8s Audit 로그를 실시간으로 수집하고 상관분석하여 공격을 하나의
                  인시던트로 재구성해 조기에 탐지하는 보안 관제 플랫폼
                </p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="text-white/50 text-xs block mb-1.5">아이디</label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoFocus
                  autoComplete="username"
                  className="w-full bg-black/40 border border-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-white/40"
                />
              </div>
              <div>
                <label className="text-white/50 text-xs block mb-1.5">비밀번호</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="w-full bg-black/40 border border-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-white/40"
                  placeholder="••••••••"
                />
              </div>

              {error && <p className="text-white text-xs bg-white/10 border border-white/15 rounded-lg px-3 py-2">{error}</p>}

              <button
                type="submit"
                disabled={!username || !password || submitting}
                className="w-full text-sm font-medium py-2 rounded-lg bg-white/90 text-black hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? "로그인 중..." : "로그인"}
              </button>

              {DEMO_PASSWORD && (
                <button
                  type="button"
                  onClick={handleDemoLogin}
                  disabled={submitting || demoSubmitting}
                  className="w-full text-sm font-medium py-2 rounded-lg bg-transparent border border-white/20 text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {demoSubmitting ? "입장 중..." : "로그인 없이 둘러보기 (평가용)"}
                </button>
              )}
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
