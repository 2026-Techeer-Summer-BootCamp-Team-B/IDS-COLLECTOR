import React from "react";
import OnboardingCard from "./OnboardingCard";

// App.jsx LAYER_NAV_ITEMS 상단의 "infra"(Infrastructure) 페이지 소개 카드 -
// 영상 교체는 dashboard/public/onboarding/infra.mp4만 추가하면 된다(코드 수정 불필요).
const PAGE = {
  key: "infra",
  label: "Infrastructure",
  desc: "로그 파이프라인 상태와 공격이 집중되는 Kubernetes 클러스터 모니터링",
  video: "/onboarding/infra.mp4",
  image: "/onboarding/infra.png",
};

export default function InfraOnboardingCard() {
  return <OnboardingCard page={PAGE} />;
}
