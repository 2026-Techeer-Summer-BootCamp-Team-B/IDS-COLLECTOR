import React, { useState } from "react";
import OnboardingCard from "./OnboardingCard";
import { ONBOARDING_PAGES } from "./onboardingPages";

// 2026-07-17: "온보딩 영상들을 컴포넌트로 이어서 하나의 영상처럼 만들고,
// 다 시청해야 로그인/회원가입 창이 나오게 해달라"는 요청 - 기존
// OnboardingSection.jsx(5개 카드를 세로로 쌓아 스크롤로 훑어보는 방식, 로그인
// 폼과 항상 같이 노출)와는 별개의 새 컴포넌트다. 여기서는 한 번에 카드 하나만
// 보여주고, 그 영상이 끝나면(onEnded) 자동으로 다음 카드로 넘어가는 식으로
// 5개를 이어붙여 "하나의 연속 재생"처럼 보이게 한다. 마지막 카드까지 다 끝나면
// onComplete()를 호출해서 LoginScreen.jsx가 로그인 폼으로 전환한다.
//
// 의도적으로 "다음"으로 건너뛰는 버튼은 넣지 않았다 - 요청이 "모든 영상을
// 시청해야" 로그인 창이 나오는 것이었기 때문. 영상이 없는 단계(플레이스홀더만
// 뜨는 경우)는 OnboardingCard 안에서 일정 시간 뒤 자동으로 다음으로 넘어가게
// 처리해뒀다(PLACEHOLDER_ADVANCE_MS) - 그래서 영상 파일이 빠진 단계가 있어도
// 전체 흐름이 막히지 않는다.
export default function OnboardingPlayer({ onComplete }) {
  const [index, setIndex] = useState(0);
  const total = ONBOARDING_PAGES.length;
  const page = ONBOARDING_PAGES[index];
  const isLast = index === total - 1;

  function handleEnded() {
    if (isLast) {
      onComplete?.();
      return;
    }
    setIndex((i) => Math.min(i + 1, total - 1));
  }

  return (
    <div className="bg-black/35 backdrop-blur-xl rounded-2xl border border-white/10 shadow-xl p-5">
      <div className="flex items-center justify-between mb-4 px-1">
        <p className="text-white/45 text-[11px] uppercase tracking-wide">대시보드 둘러보기</p>
        <p className="text-white/45 text-[11px]">
          {index + 1} / {total}
        </p>
      </div>

      {/* key={page.key}로 카드를 단계마다 완전히 새로 마운트한다 - video 엘리먼트
          자체가 새로 생성돼야 src가 바뀐 다음 영상이 처음부터 자동재생된다
          (같은 인스턴스를 유지한 채 src만 바꾸면 재생 상태가 꼬이기 쉽다). */}
      <OnboardingCard page={page} onEnded={handleEnded} key={page.key} />

      {/* 진행 표시 점 - 지금까지 지나온 단계는 채워서, 남은 단계는 옅게 */}
      <div className="flex items-center justify-center gap-1.5 mt-4">
        {ONBOARDING_PAGES.map((p, i) => (
          <span
            key={p.key}
            className={`h-1.5 rounded-full transition-all ${
              i === index ? "w-5 bg-white" : i < index ? "w-1.5 bg-white/60" : "w-1.5 bg-white/20"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
