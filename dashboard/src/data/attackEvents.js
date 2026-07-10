// Shared "attack detection" data pipeline for the SOC views.
//
// This is the single source of truth behind 4 features at once: the attack
// type donut, the detection-source donut, the recent blocked/detected logs
// table (all in IncidentsView.jsx), and the Kubernetes + GeoIP views
// (InfrastructureView.jsx). Every one of those is just a different
// aggregation of the same ATTACK_EVENTS array — that's the point: when real
// data replaces the mock generator below, all 4 views update for free.
 
import { MOCK_NOW } from "./mockLogs";
 
// Attack-type taxonomy. Colors mirror the logLevels.js severity gradient so
// the palette stays consistent across the whole app.
export const ATTACK_TYPES = [
  { key: "SQLI", label: "SQL Injection", mitre: "T1190", color: "#F2617A" },
  { key: "XSS", label: "Stored/Reflected XSS", mitre: "T1059", color: "#F2748A" },
  { key: "BRUTE_FORCE", label: "Brute Force", mitre: "T1110", color: "#F2A65A" },
  { key: "PATH_TRAVERSAL", label: "Path Traversal", mitre: "T1083", color: "#F2C48A" },
  { key: "SCANNING", label: "Recon Scanning", mitre: "T1595", color: "#E8D97A" },
  { key: "SHELL_EXEC", label: "Container Shell Exec", mitre: "T1609", color: "#C9E8DE" },
  { key: "PRIV_ESC", label: "Privilege Escalation", mitre: "T1611", color: "#A9DFD8" },
  { key: "C2_COMM", label: "C2 Communication", mitre: "T1071", color: "#A0A0A0" },
  { key: "CRED_ACCESS", label: "Credential Access", mitre: "T1552", color: "#87888C" },
];
 
// detection_source per attack type — mirrors which of the 3 defense layers
// (WAS / Falco / K8s Audit) would realistically catch each attack type.
const TYPE_SOURCE = {
  SQLI: ["WAS"],
  XSS: ["WAS"],
  PATH_TRAVERSAL: ["WAS"],
  BRUTE_FORCE: ["WAS"],
  SCANNING: ["WAS"],
  SHELL_EXEC: ["Falco"],
  C2_COMM: ["Falco"],
  CRED_ACCESS: ["Falco"],
  PRIV_ESC: ["Falco", "K8s Audit"],
};
 
// Relative frequency + rough severity bias per attack type.
const TYPE_WEIGHTS = {
  SQLI: 20,
  XSS: 12,
  BRUTE_FORCE: 18,
  PATH_TRAVERSAL: 10,
  SCANNING: 25,
  SHELL_EXEC: 8,
  PRIV_ESC: 4,
  C2_COMM: 5,
  CRED_ACCESS: 8,
};
 
const TYPE_SEVERITY_BIAS = {
  SQLI: ["CRITICAL", "HIGH", "HIGH", "MEDIUM"],
  XSS: ["HIGH", "MEDIUM", "MEDIUM"],
  BRUTE_FORCE: ["HIGH", "MEDIUM", "MEDIUM", "LOW"],
  PATH_TRAVERSAL: ["MEDIUM", "MEDIUM", "LOW"],
  SCANNING: ["LOW", "LOW", "MEDIUM"],
  SHELL_EXEC: ["CRITICAL", "CRITICAL", "HIGH"],
  PRIV_ESC: ["CRITICAL", "HIGH"],
  C2_COMM: ["CRITICAL", "HIGH"],
  CRED_ACCESS: ["HIGH", "MEDIUM"],
};
 
const MESSAGES = {
  SQLI: ["UNION SELECT 시도 차단", "잘못된 쿼리 파라미터 탐지", "인증 우회용 페이로드 차단"],
  XSS: ["<script> 태그 포함 입력 차단", "이벤트 핸들러 인젝션 탐지"],
  BRUTE_FORCE: ["연속 로그인 실패 탐지", "동일 IP 반복 인증 시도"],
  PATH_TRAVERSAL: ["../ 경로 탐색 시도 차단", "상위 디렉토리 접근 차단"],
  SCANNING: ["알려진 스캐너 User-Agent 탐지", "취약점 스캐너 시그니처 매치"],
  SHELL_EXEC: ["컨테이너 내 셸 실행 탐지", "예상치 못한 프로세스 spawn"],
  PRIV_ESC: ["특수 권한 컨테이너 생성 시도", "호스트 이스케이프 시도 탐지"],
  C2_COMM: ["알려진 C2 IP로 아웃바운드 연결", "Tor 출구 노드로 연결 시도"],
  CRED_ACCESS: ["/etc/shadow 접근 시도", "시크릿 파일 읽기 시도"],
};
 
// GeoIP reference points (approximate country centroids) + relative weight
// of attack traffic originating from each — swap for real MaxMind/IP2Location
// lookups later, the { lat, lon, count } shape is all the map needs.
export const COUNTRIES = [
  { code: "RU", name: "Russia", lat: 55.75, lon: 37.62, weight: 22 },
  { code: "VN", name: "Vietnam", lat: 21.03, lon: 105.85, weight: 14 },
  { code: "CN", name: "China", lat: 35.86, lon: 104.2, weight: 16 },
  { code: "NG", name: "Nigeria", lat: 9.08, lon: 8.68, weight: 8 },
  { code: "UA", name: "Ukraine", lat: 48.38, lon: 31.17, weight: 10 },
  { code: "IR", name: "Iran", lat: 32.43, lon: 53.69, weight: 9 },
  { code: "BR", name: "Brazil", lat: -14.24, lon: -51.93, weight: 7 },
  { code: "NL", name: "Netherlands", lat: 52.13, lon: 5.29, weight: 5 },
  { code: "DE", name: "Germany", lat: 51.17, lon: 10.45, weight: 5 },
  { code: "US", name: "United States", lat: 39.78, lon: -100.45, weight: 4 },
];
const COUNTRY_WEIGHTS = COUNTRIES.reduce((acc, c) => ((acc[c.code] = c.weight), acc), {});
 
// Kubernetes targets pool (namespace/pod) — swap for a real k8s metadata
// enrichment lookup later.
export const K8S_TARGETS = [
  { namespace: "juice-shop", pod: "juice-shop-7d9f" },
  { namespace: "juice-shop", pod: "juice-shop-a231" },
  { namespace: "payment", pod: "payment-service-5c1a" },
  { namespace: "auth", pod: "auth-service-88bd" },
  { namespace: "monitoring", pod: "falco-agent-x92k" },
  { namespace: "kube-system", pod: "kube-proxy-11ff" },
  { namespace: "ingress", pod: "nginx-ingress-77aa" },
];
 
function weightedPick(weightMap) {
  const entries = Object.entries(weightMap);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of entries) {
    if (r < w) return k;
    r -= w;
  }
  return entries[0][0];
}
 
function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
 
function randomIp() {
  return `${20 + Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 255)}.${Math.floor(
    Math.random() * 255
  )}.${Math.floor(Math.random() * 255)}`;
}
 
function randomSeverityFor(type) {
  const options = TYPE_SEVERITY_BIAS[type] || ["MEDIUM"];
  return randomFrom(options);
}
 
function generateAttackEvents(count, lookbackMs) {
  const events = [];
  for (let i = 0; i < count; i++) {
    const attackType = weightedPick(TYPE_WEIGHTS);
    const severity = randomSeverityFor(attackType);
    const source = randomFrom(TYPE_SOURCE[attackType] || ["WAS"]);
    const countryCode = weightedPick(COUNTRY_WEIGHTS);
    const country = COUNTRIES.find((c) => c.code === countryCode);
    const target = randomFrom(K8S_TARGETS);
    const timestamp = new Date(MOCK_NOW.getTime() - Math.random() * lookbackMs);
 
    // Lower-severity events get auto-blocked more often; CRITICAL/HIGH ones
    // more often stay "under investigation" since they got past the first line of defense.
    const blockChance = { LOW: 0.95, MEDIUM: 0.85, HIGH: 0.5, CRITICAL: 0.3 }[severity];
    const blocked = Math.random() < blockChance;
 
    events.push({
      id: i + 1,
      timestamp,
      attackType,
      mitre: ATTACK_TYPES.find((t) => t.key === attackType)?.mitre,
      severity,
      source,
      sourceIp: randomIp(),
      country: country.name,
      lat: country.lat,
      lon: country.lon,
      namespace: target.namespace,
      pod: target.pod,
      blocked,
      action: blocked ? "자동 차단" : Math.random() < 0.5 ? "조사중" : "모니터링",
      message: randomFrom(MESSAGES[attackType] || ["탐지됨"]),
    });
  }
  return events.sort((a, b) => b.timestamp - a.timestamp);
}
 
// 7 days of history — enough for the "최근 7일" framing used across these views.
export const ATTACK_EVENTS = generateAttackEvents(600, 7 * 24 * 60 * 60 * 1000);
 
// ---------- aggregations (each view below is just one of these) ----------
 
export function byAttackType(events) {
  const counts = events.reduce((acc, e) => ((acc[e.attackType] = (acc[e.attackType] || 0) + 1), acc), {});
  return ATTACK_TYPES.map((t) => ({ ...t, count: counts[t.key] || 0 })).sort((a, b) => b.count - a.count);
}
 
export function bySource(events) {
  const counts = events.reduce((acc, e) => ((acc[e.source] = (acc[e.source] || 0) + 1), acc), {});
  return Object.entries(counts)
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);
}
 
export function byCountry(events) {
  const grouped = events.reduce((acc, e) => {
    acc[e.country] = acc[e.country] || { country: e.country, lat: e.lat, lon: e.lon, count: 0 };
    acc[e.country].count += 1;
    return acc;
  }, {});
  return Object.values(grouped).sort((a, b) => b.count - a.count);
}
 
export function byIp(events) {
  const counts = events.reduce((acc, e) => ((acc[e.sourceIp] = (acc[e.sourceIp] || 0) + 1), acc), {});
  return Object.entries(counts)
    .map(([ip, count]) => ({ ip, count }))
    .sort((a, b) => b.count - a.count);
}
 
export function byK8sTarget(events) {
  const grouped = events.reduce((acc, e) => {
    const key = `${e.namespace}/${e.pod}`;
    acc[key] = acc[key] || { namespace: e.namespace, pod: e.pod, count: 0, topType: {} };
    acc[key].count += 1;
    acc[key].topType[e.attackType] = (acc[key].topType[e.attackType] || 0) + 1;
    return acc;
  }, {});
  return Object.values(grouped)
    .map(({ topType, ...rest }) => ({
      ...rest,
      topAttackType: Object.entries(topType).sort((a, b) => b[1] - a[1])[0]?.[0],
    }))
    .sort((a, b) => b.count - a.count);
}
 