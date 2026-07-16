import React from "react";
import OnboardingCard from "./OnboardingCard";

// App.jsx NAV_ITEMS의 "admin"(Admin / Audit) 페이지 소개 카드 - 영상 교체는
// dashboard/public/onboarding/admin.mp4만 추가하면 된다(코드 수정 불필요).
const PAGE = {
  key: "admin",
  label: "Admin / Audit",
  desc: "탐지 정책, 알림 채널, 차단 IP 관리 및 관리자 감사 로그",
  video: "/onboarding/admin.mp4",
  image: "/onboarding/admin.png",
};

export default function AdminOnboardingCard() {
  return <OnboardingCard page={PAGE} />;
}
