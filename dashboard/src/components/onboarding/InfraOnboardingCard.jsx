import React from "react";
import OnboardingCard from "./OnboardingCard";
import { ONBOARDING_PAGES } from "./onboardingPages";

// App.jsx LAYER_NAV_ITEMS 상단의 "infra"(Infrastructure) 페이지 소개 카드 -
// 영상 교체는 dashboard/public/onboarding/infra.mp4만 추가하면 된다(코드 수정 불필요).
// 2026-07-17: 내용은 onboardingPages.js로 옮기고 여기서는 자기 항목만 꺼내 쓴다
// (OnboardingPlayer.jsx와 데이터를 공유하기 위함).
const PAGE = ONBOARDING_PAGES.find((p) => p.key === "infra");

export default function InfraOnboardingCard() {
  return <OnboardingCard page={PAGE} />;
}
