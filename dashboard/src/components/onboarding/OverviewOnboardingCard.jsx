import React from "react";
import OnboardingCard from "./OnboardingCard";

// App.jsx NAV_ITEMS의 "overview" 페이지 소개 카드 - 영상 교체는
// dashboard/public/onboarding/overview.mp4만 추가하면 된다(코드 수정 불필요).
const PAGE = {
  key: "overview",
  label: "Overview",
  desc: "전체 로그 및 위협 현황을 실시간으로 한눈에 확인",
  video: "/onboarding/overview.mp4",
  image: "/onboarding/overview.png",
};

export default function OverviewOnboardingCard() {
  return <OnboardingCard page={PAGE} />;
}
