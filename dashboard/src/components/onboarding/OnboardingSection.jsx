import React from "react";
import OverviewOnboardingCard from "./OverviewOnboardingCard";
import IncidentsOnboardingCard from "./IncidentsOnboardingCard";
import AttackOnboardingCard from "./AttackOnboardingCard";
import InfraOnboardingCard from "./InfraOnboardingCard";
import AdminOnboardingCard from "./AdminOnboardingCard";

// LoginScreen.jsx의 "대시보드 둘러보기" 스크롤 영역 - App.jsx의 5개 메인
// 페이지(Overview/Incidents/ATT&CK/Infrastructure/Admin) 순서 그대로, 각각을
// 독립된 컴포넌트 파일로 분리했다(2026-07-16(2차): "각 페이지마다 각
// 컴포넌트로 만들어서 온보딩 영상 제작"). 페이지 하나의 소개 영상/설명만
// 바꾸고 싶을 때 이 폴더 안 해당 파일 하나만 건드리면 되고, LoginScreen.jsx는
// 이 순서 목록만 알면 된다.
export default function OnboardingSection() {
  return (
    <div className="bg-black/35 backdrop-blur-xl rounded-2xl border border-white/10 shadow-xl p-5">
      <p className="text-white/45 text-[11px] uppercase tracking-wide mb-4 px-1">대시보드 둘러보기</p>
      <div className="space-y-6 max-h-[80vh] overflow-y-auto pr-2">
        <OverviewOnboardingCard />
        <IncidentsOnboardingCard />
        <AttackOnboardingCard />
        <InfraOnboardingCard />
        <AdminOnboardingCard />
      </div>
    </div>
  );
}
