import React from "react";
import OnboardingCard from "./OnboardingCard";

// App.jsx NAV_ITEMS의 "attack"(ATT&CK) 페이지 소개 카드 - 영상 교체는
// dashboard/public/onboarding/attack.mp4만 추가하면 된다(코드 수정 불필요).
const PAGE = {
  key: "attack",
  label: "ATT&CK",
  desc: "MITRE ATT&CK 기반 탐지 기법 및 커버리지 현황",
  video: "/onboarding/attack.mp4",
  image: "/onboarding/attack.png",
};

export default function AttackOnboardingCard() {
  return <OnboardingCard page={PAGE} />;
}
