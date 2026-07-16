// event.module(was/waf/falco/k8s_audit — servers/normalizer/app/schemas.py) ->
// 사람이 읽는 라벨/색상. components/badges.jsx의 SOURCE_META(WAS/Falco/"K8s
// Audit" 표시용 키)와 짝을 맞춘다.
export const MODULE_META = {
  // was는 critical(#FF1F4B)과 같은 채도/명도로 색상만 파랑쪽으로 돌린 톤 —
  // 도넛 차트에서 "빨강만큼 선명하지만 파란" 색으로 다른 모듈들과 대비되게.
  was: { label: "WAS", color: "#1F57FF" },
  falco: { label: "Falco", color: "#A64DFF" },
  // 기존 네온 연두(#00FFA6, mint 액센트와 동일)가 너무 밝다는 피드백 — 중간
  // 톤 초록으로 낮춤.
  k8s_audit: { label: "K8s Audit", color: "#22C55E" },
  // waf는 예전엔 비활성화 상태라 회색(그레이=fallback "Unknown" 색과 동일)이었는데,
  // 2026-07-16부터 WAF 백엔드가 실제로 돌면서 이벤트가 꾸준히 들어오게 됐다 -
  // Unknown과 구분 안 되던 문제라 DONUT_PALETTE의 앰버 톤으로 바꿔 다른 3개
  // 모듈(파랑/보라/초록)과 나란히 놓아도 또렷하게 구분되게 한다.
  waf: { label: "WAF", color: "#D68C3E" },
};

export function getModuleMeta(module) {
  return MODULE_META[module] || { label: module || "Unknown", color: "#8890B5" };
}
