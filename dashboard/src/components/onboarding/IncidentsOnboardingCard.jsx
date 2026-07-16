import React from "react";
import OnboardingCard from "./OnboardingCard";

// App.jsx NAV_ITEMS의 "incidents" 페이지 소개 카드 - 영상 교체는
// dashboard/public/onboarding/incidents.mp4만 추가하면 된다(코드 수정 불필요).
const PAGE = {
  key: "incidents",
  label: "Incidents",
  desc: "상관분석을 통해 여러 이벤트를 하나의 공격 인시던트로 통합",
  video: "/onboarding/incidents.mp4",
  image: "/onboarding/incidents.png",
};

export default function IncidentsOnboardingCard() {
  return <OnboardingCard page={PAGE} />;
}
