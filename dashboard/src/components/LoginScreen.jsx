import React, { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";

// 2026-07-16: 처음 로그인하는 사용자가 "이 대시보드에 뭐가 있지?"부터 궁금할 것
// 같다는 피드백 - App.jsx의 NAV_ITEMS/LAYER_NAV_ITEMS와 같은 5개 메인 페이지를
// 로그인 전에 온보딩 캐러셀로 한 장씩 소개한다(다음/이전 화살표 + 점 인디케이터).
// accent는 그 페이지에서 실제로 쓰는 톤을 최대한 재사용(Incidents=critical,
// ATT&CK=high, Infrastructure=was, Admin=muted)해서 나중에 대시보드에 들어갔을
// 때 "아 그 색이 이 페이지였구나" 하고 이어지게 했다.
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
    desc: "전체 로그량·심각도·탐지 소스를 한눈에 보는 실시간 요약",
    accent: "bg-dash-mint",
    video: "/onboarding/overview.mp4",
    image: "/onboarding/overview.png",
  },
  {
    key: "incidents",
    label: "Incidents",
    desc: "여러 로그를 상관분석으로 하나로 묶은 공격 사건 조사·대응",
    accent: "bg-dash-critical",
    video: "/onboarding/incidents.mp4",
    image: "/onboarding/incidents.png",
  },
  {
    key: "attack",
    label: "ATT&CK",
    desc: "MITRE ATT&CK 매트릭스 기준 탐지 기법·커버리지 현황",
    accent: "bg-dash-high",
    video: "/onboarding/attack.mp4",
    image: "/onboarding/attack.png",
  },
  {
    key: "infra",
    label: "Infrastructure",
    desc: "로그 파이프라인 상태와 실제 공격이 몰린 K8s 클러스터 대상",
    accent: "bg-dash-was",
    video: "/onboarding/infra.mp4",
    image: "/onboarding/infra.png",
  },
  {
    key: "admin",
    label: "Admin / Audit",
    desc: "탐지 룰·알림 채널·차단 IP 관리와 관리자 조치 감사 로그",
    accent: "bg-dash-muted",
    video: "/onboarding/admin.mp4",
    image: "/onboarding/admin.png",
  },
];

// 미디어 로드 실패는 슬라이드(key)별로 추적 - 영상이 없거나 깨졌으면 이미지로,
// 이미지도 없으면 accent 톤의 플레이스홀더 블록으로 조용히 대체한다(로고와
// 같은 onError 폴백 패턴).
function OnboardingCarousel() {
  const [index, setIndex] = useState(0);
  const [videoFailed, setVideoFailed] = useState({});
  const [imageFailed, setImageFailed] = useState({});
  const page = FEATURE_PAGES[index];

  // 6초마다 자동으로 다음 장 — 사용자가 화살표/점을 직접 누르면 그 시점부터
  // 다시 6초 카운트(아래 useEffect의 deps에 index가 있어서 index가 바뀔 때마다
  // 타이머가 리셋됨).
  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % FEATURE_PAGES.length), 6000);
    return () => clearInterval(timer);
  }, [index]);

  function go(delta) {
    setIndex((i) => (i + delta + FEATURE_PAGES.length) % FEATURE_PAGES.length);
  }

  const showVideo = page.video && !videoFailed[page.key];
  const showImage = !showVideo && page.image && !imageFailed[page.key];
  const showPlaceholder = !showVideo && !showImage;

  return (
    <div>
      <div className="relative h-44 mx-7 rounded-xl overflow-hidden bg-black/30 border border-white/10">
        {showVideo && (
          <video
            key={`${page.key}-video`}
            src={page.video}
            className="w-full h-full object-cover"
            autoPlay
            muted
            loop
            playsInline
            onError={() => setVideoFailed((m) => ({ ...m, [page.key]: true }))}
          />
        )}
        {showImage && (
          <img
            key={`${page.key}-image`}
            src={page.image}
            alt={page.label}
            className="w-full h-full object-cover"
            onError={() => setImageFailed((m) => ({ ...m, [page.key]: true }))}
          />
        )}
        {showPlaceholder && (
          <div className={`absolute inset-0 flex items-center justify-center ${page.accent}/10`}>
            <span className="text-white/40 text-[11px]">{page.label} 화면 준비 중</span>
          </div>
        )}

        <button
          type="button"
          onClick={() => go(-1)}
          aria-label="이전 페이지 소개"
          className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center text-sm transition-colors"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          aria-label="다음 페이지 소개"
          className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center text-sm transition-colors"
        >
          ›
        </button>
      </div>

      <div className="px-7 pt-4 pb-1">
        <div className="flex items-center gap-2 mb-1.5">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${page.accent}`} />
          <p className="text-white text-sm font-semibold">{page.label}</p>
        </div>
        <p className="text-white/65 text-xs leading-relaxed">{page.desc}</p>
      </div>

      <div className="flex items-center justify-center gap-1.5 px-7 pt-4 pb-7">
        {FEATURE_PAGES.map((p, i) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`${p.label} 소개로 이동`}
            className={`h-1.5 rounded-full transition-all ${i === index ? "w-5 bg-white" : "w-1.5 bg-white/30 hover:bg-white/50"}`}
          />
        ))}
      </div>
    </div>
  );
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
  // 로드가 실패하면 기존의 민트 사각 아이콘으로 조용히 대체 - 깨진 이미지 아이콘이
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
    // 2026-07-16: 대각선으로 흰색/검정 절반씩 나뉜 배경 - linear-gradient에
    // 같은 색을 50% 지점에서 하드 스톱으로 두 번 줘서 그라데이션이 아니라
    // 또렷한 경계선으로 갈라지게 했다. 135deg = 좌상단 흰색, 우하단 검정.
    // 여기에 은은한 민트/퍼플 글로우를 얹어 로그인 페이지만 밋밋하지 않게.
    <div
      className="min-h-screen relative flex items-center justify-center px-4 py-10 overflow-hidden"
      style={{ background: "linear-gradient(135deg, #F4F5FA 0%, #F4F5FA 50%, #05060B 50%, #05060B 100%)" }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 55% 45% at 82% 18%, rgb(0 255 166 / 0.16), transparent), radial-gradient(ellipse 50% 40% at 18% 82%, rgb(166 77 255 / 0.14), transparent)",
        }}
      />

      {/* 2026-07-16: 로그인 전에 "이 대시보드에 뭐가 있는지" 미리 보여주려고
          한 칼럼(폼만) 구조에서 좌/우 2단으로 넓혔다 - 왼쪽은 로고+서비스 설명
          (고정) + 5개 메인 페이지를 한 장씩 넘겨보는 온보딩 캐러셀, 오른쪽은
          로그인 폼. 화면이 좁으면(lg 미만) 세로로 쌓인다. 로그인 폼은 캐러셀과
          별개로 항상 고정이라, 소개를 넘겨보다가 로그인 입력이 날아가는 일은
          없다. 두 블록 다 자체 반투명 다크 글래스 배경이 있어서 대각선 배경의
          흰/검정 어느 쪽에 걸치든 글자가 항상 또렷하게 읽힌다. */}
      <div className="relative w-full max-w-4xl grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-6 items-center">
        <div className="bg-black/35 backdrop-blur-md rounded-2xl border border-white/10 shadow-xl overflow-hidden">
          <div className="flex items-center gap-3 px-7 pt-7 pb-5">
            {!logoFailed ? (
              <img
                src="/logo.png"
                alt="SENTINEL-OPS"
                onError={() => setLogoFailed(true)}
                className="w-14 h-14 rounded-2xl object-cover shadow-lg shrink-0"
              />
            ) : (
              <div className="w-14 h-14 rounded-2xl bg-dash-mint/20 flex items-center justify-center shrink-0 glow-box-mint">
                <span className="w-5 h-5 rounded-sm bg-dash-mint" />
              </div>
            )}
            <div>
              <p className="text-white font-semibold text-lg leading-none tracking-wide glow-mint">SENTINEL-OPS</p>
              <p className="text-white/75 text-xs mt-2 leading-relaxed">
                WAS · WAF · Falco · K8s Audit 로그를 실시간으로 모아 상관분석하고, 공격을 하나의 인시던트로
                재구성해 조기에 탐지하는 보안 관제 대시보드
              </p>
            </div>
          </div>

          <OnboardingCarousel />
        </div>

        <form onSubmit={handleSubmit} className="bg-dash-surface/95 backdrop-blur-md rounded-2xl p-6 space-y-4 shadow-2xl">
          <div>
            <label className="text-dash-muted text-xs block mb-1.5">아이디</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              className="w-full bg-dash-bg text-dash-fg text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-1 focus:ring-dash-mint"
            />
          </div>
          <div>
            <label className="text-dash-muted text-xs block mb-1.5">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full bg-dash-bg text-dash-fg text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-1 focus:ring-dash-mint"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-dash-critical text-xs bg-dash-critical/10 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={!username || !password || submitting}
            className="w-full text-sm font-medium py-2.5 rounded-lg bg-dash-mint/15 text-dash-mint hover:bg-dash-mint/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "로그인 중..." : "로그인"}
          </button>
        </form>
      </div>
    </div>
  );
}
