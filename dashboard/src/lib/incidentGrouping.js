// 2026-07-17: Incidents 좌측 리스트용 "유사 항목 묶어보기" 필터.
//
// 같은 상관 규칙(matched_scenario_rule_id)이 짧은 시간에 여러 번 발화하면(예:
// 같은 대역의 IP를 돌려가며 시도하는 브루트포스, 혹은 서버 쪽 dedup 창을 벗어난
// 재발화) 겉보기엔 거의 같은 인시던트가 리스트에 여러 줄로 쌓인다. 이 모듈은
// 서버 데이터를 바꾸지 않고, 프론트에서만 "같은 규칙 + 같은 상관 키(또는 IP가
// 비슷한 대역)"인 인시던트를 하나의 그룹으로 묶어서 보여주는 용도다.
//
// correlation_key_type 값은 백엔드 YAML/문서 기준 "source.ip"(점 표기)다.
// IncidentsView.jsx의 다른 곳(소스 IP 차단 버튼, CSV/PDF export)도 예전엔
// "source_ip"(언더스코어)로 체크하는 버그가 있어 항상 false였는데(2026-07-21
// isIpKeyType()으로 통일해 수정) - 혹시 남아있을 수 있는 구버전 데이터/다른
// 어긋남에 대비해 두 표기 다 IP로 인식하도록 여전히 방어적으로 처리한다.
const IP_KEY_TYPES = new Set(["source.ip", "source_ip"]);

/** "1.2.3.4" -> [1,2,3,4] (유효하지 않으면 null) */
function parseIPv4(value) {
  if (typeof value !== "string") return null;
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => Number(p));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return octets;
}

/**
 * IP를 prefixBits 단위로 잘라 그룹핑 키 문자열로 변환.
 * prefixBits: 32(정확히 일치) | 24(같은 C클래스 대역, 기본값) | 16(더 넓은 대역)
 * IPv4로 파싱이 안 되면(호스트네임 등 예외 값) null - 이 경우 원본 문자열 그대로 씀.
 */
export function ipPrefixKey(value, prefixBits = 24) {
  const octets = parseIPv4(value);
  if (!octets) return null;
  const octetCount = prefixBits >= 32 ? 4 : prefixBits >= 24 ? 3 : prefixBits >= 16 ? 2 : 1;
  return octets.slice(0, octetCount).join(".") + (octetCount < 4 ? ".0/" + prefixBits : "");
}

export function isIpKeyType(correlationKeyType) {
  return IP_KEY_TYPES.has(correlationKeyType);
}

/** 인시던트 하나를 어느 그룹에 넣을지 결정하는 키. */
function groupKeyFor(incident, ipToleranceBits) {
  const scenario = incident.matched_scenario_rule_id || "no-scenario";
  const type = incident.correlation_key_type || "unknown";
  const value = incident.correlation_key_value ?? "";

  if (isIpKeyType(type)) {
    const prefixed = ipPrefixKey(value, ipToleranceBits);
    if (prefixed) return `${scenario}|ip:${prefixed}`;
  }
  return `${scenario}|${type}:${value}`;
}

/**
 * incidents 배열을 groupKeyFor 기준으로 묶어서
 * [{ key, members: [최신순 정렬된 원본 incident...], representative, count }] 로 반환.
 * ipToleranceBits: 32(정확히 일치)/24(기본, 같은 /24 대역)/16(넓게).
 * 그룹 순서는 각 그룹의 최신 updated_at 기준 내림차순.
 */
export function groupSimilarIncidents(incidents, ipToleranceBits = 24) {
  const map = new Map();
  for (const inc of incidents) {
    const key = groupKeyFor(inc, ipToleranceBits);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(inc);
  }

  const groups = Array.from(map.entries()).map(([key, members]) => {
    const sorted = [...members].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    return { key, members: sorted, representative: sorted[0], count: sorted.length };
  });

  groups.sort((a, b) => new Date(b.representative.updated_at) - new Date(a.representative.updated_at));
  return groups;
}
