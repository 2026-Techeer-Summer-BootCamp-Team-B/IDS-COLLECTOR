import React from "react";

// 사이드바 네비게이션용 아이콘 세트 - 외부 아이콘 라이브러리 없이 인라인 SVG로
// 직접 구현 (24x24 기준, stroke=currentColor라 부모의 text-* 클래스로 색이
// 자동 상속됨 - active/inactive 상태 전환이 별도 처리 없이 그대로 먹힘).
const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export function OverviewIcon({ className }) {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </svg>
  );
}

export function IncidentsIcon({ className }) {
  return (
    <svg {...base} className={className}>
      <path d="M12 3.5 L21 19.5 L3 19.5 Z" />
      <line x1="12" y1="9.5" x2="12" y2="14" />
      <circle cx="12" cy="16.8" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function AttackIcon({ className }) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <line x1="12" y1="1.5" x2="12" y2="4.5" />
      <line x1="12" y1="19.5" x2="12" y2="22.5" />
      <line x1="1.5" y1="12" x2="4.5" y2="12" />
      <line x1="19.5" y1="12" x2="22.5" y2="12" />
    </svg>
  );
}

export function InfrastructureIcon({ className }) {
  return (
    <svg {...base} className={className}>
      <rect x="3.5" y="3.5" width="17" height="5" rx="1.2" />
      <rect x="3.5" y="9.5" width="17" height="5" rx="1.2" />
      <rect x="3.5" y="15.5" width="17" height="5" rx="1.2" />
      <circle cx="6.5" cy="6" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="6.5" cy="12" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="6.5" cy="18" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function AdminIcon({ className }) {
  return (
    <svg {...base} className={className}>
      <rect x="5" y="3.5" width="14" height="17" rx="1.5" />
      <path d="M9 3.5 V2.5 a1 1 0 0 1 1-1 h4 a1 1 0 0 1 1 1 V3.5" />
      <path d="M8.5 12 l2.2 2.2 L16 9" />
    </svg>
  );
}

export function WasIcon({ className }) {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="4.5" width="18" height="15" rx="1.8" />
      <line x1="3" y1="8.5" x2="21" y2="8.5" />
      <circle cx="5.6" cy="6.5" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="7.6" cy="6.5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function WafIcon({ className }) {
  return (
    <svg {...base} className={className}>
      <path d="M12 3 L19.5 6 V11.5 C19.5 16 16.2 19.3 12 21 C7.8 19.3 4.5 16 4.5 11.5 V6 Z" />
      <path d="M9 12 l2.2 2.2 L15.2 9.8" />
    </svg>
  );
}

export function FalcoIcon({ className }) {
  return (
    <svg {...base} className={className}>
      <path d="M2.5 12 C5.5 6.5 9 4 12 4 C15 4 18.5 6.5 21.5 12 C18.5 17.5 15 20 12 20 C9 20 5.5 17.5 2.5 12 Z" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  );
}

export function K8sAuditIcon({ className }) {
  return (
    <svg {...base} className={className}>
      <path d="M12 2.5 L20.5 7.2 V16.8 L12 21.5 L3.5 16.8 V7.2 Z" />
      <path d="M12 2.5 V21.5" />
      <path d="M3.5 7.2 L12 12 L20.5 7.2" />
    </svg>
  );
}

// 로고 마크용 - 사이드바 최상단 "SENTINEL-OPS" 옆 8x8 타일 안에 들어가는 아이콘
// (기존엔 그냥 색칠된 네모였음 - 실시간 감시/보안이라는 의미에 맞게 레이더/실드로 교체)
export function LogoMarkIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="8.2" opacity="0.55" />
      <circle cx="12" cy="12" r="4.6" opacity="0.85" />
      <path d="M12 12 L12 4" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
