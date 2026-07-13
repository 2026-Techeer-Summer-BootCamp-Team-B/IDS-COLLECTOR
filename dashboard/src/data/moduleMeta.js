// event.module(was/waf/falco/k8s_audit — servers/normalizer/app/schemas.py) ->
// 사람이 읽는 라벨/색상. components/badges.jsx의 SOURCE_META(WAS/Falco/"K8s
// Audit" 표시용 키)와 짝을 맞춘다. waf는 현재 비활성화 상태라 거의 안 나오지만
// 혹시 나오면 회색으로 표시.
export const MODULE_META = {
  was: { label: "WAS", color: "#00C2FF" },
  falco: { label: "Falco", color: "#A64DFF" },
  k8s_audit: { label: "K8s Audit", color: "#00FFA6" },
  waf: { label: "WAF", color: "#8890B5" },
};

export function getModuleMeta(module) {
  return MODULE_META[module] || { label: module || "Unknown", color: "#8890B5" };
}
