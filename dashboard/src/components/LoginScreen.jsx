import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";

// 2026-07-16: 처음 로그인하는 사용자가 "이 대시보드에 뭐가 있지?"부터 궁금할 것
// 같다는 피드백 - App.jsx의 NAV_ITEMS/LAYER_NAV_ITEMS와 같은 5개 메인 페이지를
// 로그인 전에 소개한다. 색상은 모노크롬 컨셉(요청받은 스타일 - white/gray/black만,
// 파랑·네온 없음)이라 예전처럼 페이지별 accent 컬러는 안 쓰고 전부 흰색/회색 톤으로
// 통일했다.
//
// video/image는 아직 실제 파일이 없어서 지금은 항상 플레이스홀더가 뜬다 -
// dashboard/public/onboarding/ 아래에 같은 파일명으로 넣으면(예: overview.mp4)
// 바로 그 자리에 재생된다. Vite는 public/ 밑을 그대로 빌드 결과물 루트로
// 복사하므로 코드에서는 "/onboarding/xxx.mp4"처럼 절대경로로 참조하면 된다
// (로컬 개발 서버·Vercel 배포 둘 다 동일하게 동작).
const FEATURE_PAGES = [
  {
    key: "overview",
    label: "Overview",
    desc: "전체 로그 및 위협 현황을 실시간으로 한눈에 확인",
    video: "/onboarding/overview.mp4",
    image: "/onboarding/overview.png",
  },
  {
    key: "incidents",
    label: "Incidents",
    desc: "상관분석을 통해 여러 이벤트를 하나의 공격 인시던트로 통합",
    video: "/onboarding/incidents.mp4",
    image: "/onboarding/incidents.png",
  },
  {
    key: "attack",
    label: "ATT&CK",
    desc: "MITRE ATT&CK 기반 탐지 기법 및 커버리지 현황",
    video: "/onboarding/attack.mp4",
    image: "/onboarding/attack.png",
  },
  {
    key: "infra",
    label: "Infrastructure",
    desc: "로그 파이프라인 상태와 공격이 집중되는 Kubernetes 클러스터 모니터링",
    video: "/onboarding/infra.mp4",
    image: "/onboarding/infra.png",
  },
  {
    key: "admin",
    label: "Admin / Audit",
    desc: "탐지 정책, 알림 채널, 차단 IP 관리 및 관리자 감사 로그",
    video: "/onboarding/admin.mp4",
    image: "/onboarding/admin.png",
  },
];

// 미디어 로드 실패는 카드별로 독립 추적(각 카드가 자기 state를 들고 있음) -
// 영상이 없거나 깨졌으면 이미지로, 이미지도 없으면 플레이스홀더 블록으로 조용히
// 대체한다(로고와 같은 onError 폴백 패턴). 이미지가 object-contain인 이유는
// 대시보드 스크린샷은 폭이 넓은 경우가 많아서 object-cover로 자르면 양옆이
// 잘려나가 "화면이 깨진 것처럼" 보인다는 피드백 때문 - 검정 레터박스를 감수하고
// 원본 비율 그대로 다 보이게 했다.
function OnboardingCard({ page }) {
  const [videoFailed, setVideoFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const showVideo = page.video && !videoFailed;
  const showImage = !showVideo && page.image && !imageFailed;
  const showPlaceholder = !showVideo && !showImage;

  return (
    <div>
      <div className="relative h-64 rounded-xl overflow-hidden bg-black/50 border border-white/10">
        {showVideo && (
          <video
            src={page.video}
            className="w-full h-full object-cover"
            autoPlay
            muted
            loop
            playsInline
            onError={() => setVideoFailed(true)}
          />
        )}
        {showImage && (
          <img
            src={page.image}
            alt={page.label}
            className="w-full h-full object-contain bg-black"
            onError={() => setImageFailed(true)}
          />
        )}
        {showPlaceholder && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70">
            <span className="text-white/35 text-xs">{page.label} 화면 준비 중</span>
          </div>
        )}
      </div>

      <div className="pt-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-1.5 h-1.5 rounded-full bg-white/60 shrink-0" />
          <p className="text-white text-sm font-semibold">{page.label}</p>
        </div>
        <p className="text-white/55 text-xs leading-relaxed">{page.desc}</p>
      </div>
    </div>
  );
}

// 상단 툴바의 마이크/카메라/화면공유/전체화면 아이콘 - 참고 스타일 프롬프트에
// 있던 장식용 요소라 실제 동작은 없다(로그인 화면에 화상회의 컨트롤이 있을
// 이유는 없지만, 무채색 프리미엄 SaaS 톤을 내는 장식으로만 사용).
function ToolbarIcon({ children }) {
  return <span className="w-4 h-4 text-white/60">{children}</span>;
}

// servers/platform-api/app/auth.py 기준 — users 테이블(pgcrypto) 실사용자 로그인.
// 초기 관리자 계정은 postgres init/005-seed-admin-user.sh가
// ADMIN_INITIAL_PASSWORD(.env)로 시드한다 - 화면에 기본 자격증명을 노출하지 않는다.
export default function LoginScreen() {
  const { login, error } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // 2026-07-16: 로고(public/logo.png)가 아직 안 올라와 있을 수도 있으니, 이미지
  // 로드가 실패하면 기존의 흰 사각 아이콘으로 조용히 대체 - 깨진 이미지 아이콘이
  // 그대로 노출되는 것보다 낫다.
  const [logoFailed, setLogoFailed] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!username || !password || submitting) return;
    setSubmitting(true);
    await login(username, password);
    setSubmitting(false);
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center px-4 py-8 overflow-hidden bg-black">
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

      {/* 우하단 반짝임 장식 */}
      <div className="absolute bottom-8 right-10 hidden sm:flex items-end gap-2.5 pointer-events-none opacity-80">
        <span className="text-white text-base leading-none">✦</span>
        <span className="text-white/60 text-xs leading-none mb-0.5">✦</span>
        <span className="text-white text-xl leading-none">✦</span>
      </div>

      {/* 2026-07-16: "로그인은 상단 고정, 온보딩 소개는 여러 장을 세로로 쌓아
          스크롤로 훑어본다"는 요청대로 구조를 다시 짰다 - 로그인 카드가 위에
          먼저 오고(페이지 자체는 스크롤 안 해도 항상 보임), 그 아래 소개 카드가
          내부 스크롤 영역(온보딩 카드 5개, 각각 전보다 훨씬 큰 h-64)을 갖는다. */}
      <div className="relative w-full max-w-xl space-y-5">
        <div className="bg-black/50 backdrop-blur-xl rounded-2xl border border-white/15 shadow-2xl px-7 py-7">
          <div className="flex items-center gap-3 mb-6">
            {!logoFailed ? (
              <img
                src="/logo.png"
                alt="SENTINEL-OPS"
                onError={() => setLogoFailed(true)}
                className="w-14 h-14 rounded-2xl object-cover shadow-lg shrink-0"
              />
            ) : (
              <div className="w-14 h-14 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center shrink-0">
                <span className="w-5 h-5 rounded-sm bg-white" />
              </div>
            )}
            <div>
              <p className="text-white font-semibold text-lg leading-none tracking-wide">SENTINEL-OPS</p>
              <p className="text-white/60 text-xs mt-2 leading-relaxed">
                WAS · WAF · Falco · K8s Audit 로그를 실시간으로 수집하고 상관분석하여 공격을 하나의
                인시던트로 재구성해 조기에 탐지하는 보안 관제 플랫폼
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-white/50 text-xs block mb-1.5">아이디</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
                className="w-full bg-black/40 border border-white/10 text-white text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-1 focus:ring-white/40"
              />
            </div>
            <div>
              <label className="text-white/50 text-xs block mb-1.5">비밀번호</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full bg-black/40 border border-white/10 text-white text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-1 focus:ring-white/40"
                placeholder="••••••••"
              />
            </div>

            {error && <p className="text-white text-xs bg-white/10 border border-white/15 rounded-lg px-3 py-2">{error}</p>}

            <button
              type="submit"
              disabled={!username || !password || submitting}
              className="w-full text-sm font-medium py-2.5 rounded-lg bg-white/90 text-black hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "로그인 중..." : "로그인"}
            </button>
          </form>
        </div>

        <div className="bg-black/35 backdrop-blur-xl rounded-2xl border border-white/10 shadow-xl p-5">
          <p className="text-white/45 text-[11px] uppercase tracking-wide mb-4 px-1">대시보드 둘러보기</p>
          <div className="space-y-6 max-h-[420px] overflow-y-auto pr-2">
            {FEATURE_PAGES.map((page) => (
              <OnboardingCard key={page.key} page={page} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
