import React, { useRef, useState } from "react";

// 2026-07-17(4차): "로그인 화면 온보딩을 Remotion으로 만든 온보딩데모.mp4
// 하나로 바꿔달라, 건너뛰기도 되게 해달라, 영상 끝나면 로그인 창이 나오게"
// 요청으로 완전히 다시 짰다. 이전엔 페이지별 카드 5개를 순서대로 넘기는
// 방식(ONBOARDING_PAGES + OnboardingCard)이었지만, 이제는 이미
// dashboard/remotion-onboarding에서 사전 렌더링해 dashboard/public/onboarding/
// 에 넣어둔 단일 영상(onboarding-demo.mp4) 하나만 재생한다 - 페이지별
// 컴포넌트들(OnboardingCard.jsx, onboardingPages.js, XxxOnboardingCard.jsx)은
// 더 이상 여기서 쓰지 않지만 혹시 몰라 폴더에는 남겨뒀다.
const VIDEO_SRC = "/onboarding/onboarding-demo.mp4";

export default function OnboardingPlayer({ onComplete }) {
  const videoRef = useRef(null);
  const [ready, setReady] = useState(false);

  function handleSkip() {
    onComplete?.();
  }

  return (
    <div className="bg-black/35 backdrop-blur-xl rounded-2xl border border-white/10 shadow-xl p-5">
      <div className="flex items-center justify-between mb-4 px-1">
        <p className="text-white/45 text-[11px] uppercase tracking-wide">대시보드 둘러보기</p>
        <button
          type="button"
          onClick={handleSkip}
          className="text-white/40 hover:text-white/70 text-[11px] underline-offset-2 hover:underline transition-colors"
        >
          건너뛰기
        </button>
      </div>

      {/* 영상이 끝나면(onEnded) 자동으로 로그인 폼으로 넘어간다. 기다리기 싫으면
          우측 상단/하단 "건너뛰기" 버튼으로 언제든 바로 넘길 수 있다. */}
      <div className="relative rounded-xl overflow-hidden bg-black" style={{ aspectRatio: "16 / 9" }}>
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="w-6 h-6 border-2 border-white/25 border-t-white/70 rounded-full animate-spin" />
          </div>
        )}
        <video
          ref={videoRef}
          src={VIDEO_SRC}
          autoPlay
          muted
          playsInline
          onCanPlay={() => setReady(true)}
          onEnded={handleSkip}
          className="w-full h-full object-contain"
        />
      </div>

      <div className="flex items-center justify-end mt-4">
        <button
          type="button"
          onClick={handleSkip}
          className="text-black text-xs font-medium px-4 py-1.5 rounded-lg bg-white/90 hover:bg-white transition-colors"
        >
          건너뛰고 로그인하기 →
        </button>
      </div>
    </div>
  );
}
