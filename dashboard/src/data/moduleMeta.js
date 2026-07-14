// event.module(was/waf/falco/k8s_audit — servers/normalizer/app/schemas.py) ->
// 사람이 읽는 라벨/색상. components/badges.jsx의 SOURCE_META(WAS/Falco/"K8s
// Audit" 표시용 키)와 짝을 맞춘다. waf는 현재 비활성화 상태라 거의 안 나오지만
// 혹시 나오면 회색으로 표시.
export const MODULE_META = {
  // was는 critical(#FF1F4B)과 같은 채도/명도로 색상만 파랑쪽으로 돌린 톤 —
  // 도넛 차트에서 "빨강만큼 선명하지만 파란" 색으로 다른 모듈들과 대비되게.
  was: { label: "WAS", color: "#1F57FF" },
  falco: { label: "Falco", color: "#A64DFF" },
  // 기존 네온 연두(#00FFA6, mint 액센트와 동일)가 너무 밝다는 피드백 — 중간
  // 톤 초록으로 낮춤.
  k8s_audit: { label: "K8s Audit", color: "#22C55E" },
  waf: { label: "WAF", color: "#8890B5" },
};

export function getModuleMeta(module) {
  return MODULE_META[module] || { label: module || "Unknown", color: "#8890B5" };
}
