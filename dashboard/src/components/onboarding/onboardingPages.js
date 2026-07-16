// App.jsx NAV_ITEMS/LAYER_NAV_ITEMS와 같은 순서의 5개 메인 페이지 소개 데이터.
// 예전엔 이 내용이 OverviewOnboardingCard.jsx 등 5개 파일에 각자 흩어져
// 있었는데(각 파일이 자기 PAGE 객체를 들고 OnboardingCard를 감싸는 구조),
// 2026-07-17에 OnboardingPlayer.jsx(영상 5개를 이어붙여 하나의 연속 재생
// 흐름으로 만드는 컴포넌트)를 추가하면서 같은 데이터가 필요해져 여기 한
// 곳으로 모았다 - 두 군데서 따로 관리하면 문구/파일명이 드리프트 나기 쉽다.
// 개별 XOnboardingCard.jsx 파일들도 이제 이 배열에서 자기 항목만 꺼내 쓴다.
export const ONBOARDING_PAGES = [
  {
    key: "overview",
    label: "Overview",
    desc: "전체 로그 및 위협 현황을 실시간으로 한눈에 확인",
    video: "/onboarding/overview.mp4",
    image: "/onboarding/overview.png",
  },
  {
    key: "incidents",
    label: "Incidents",
    desc: "상관분석을 통해 여러 이벤트를 하나의 공격 인시던트로 통합",
    video: "/onboarding/incidents.mp4",
    image: "/onboarding/incidents.png",
  },
  {
    key: "attack",
    label: "ATT&CK",
    desc: "MITRE ATT&CK 기반 탐지 기법 및 커버리지 현황",
    video: "/onboarding/attack.mp4",
    image: "/onboarding/attack.png",
  },
  {
    key: "infra",
    label: "Infrastructure",
    desc: "로그 파이프라인 상태와 공격이 집중되는 Kubernetes 클러스터 모니터링",
    video: "/onboarding/infra.mp4",
    image: "/onboarding/infra.png",
  },
  {
    key: "admin",
    label: "Admin / Audit",
    desc: "탐지 정책, 알림 채널, 차단 IP 관리 및 관리자 감사 로그",
    video: "/onboarding/admin.mp4",
    image: "/onboarding/admin.png",
  },
];
