// Detection rule taxonomy for the Admin/Audit tab's "룰별 적중 랭킹".
// Each rule maps to one attack type so hit counts can be derived straight
// from ATTACK_EVENTS — swap for a real rule-engine config table later,
// keep the { id, name, attackType, enabled, description } shape.
 
export const RULES = [
  { id: "R-01", name: "SQL Injection Pattern Match", attackType: "SQLI", enabled: true, description: "WAS 요청 파라미터에서 SQL 메타문자/UNION 패턴 탐지" },
  { id: "R-02", name: "Stored/Reflected XSS Filter", attackType: "XSS", enabled: true, description: "<script>, on* 이벤트 핸들러 등 XSS 페이로드 패턴 탐지" },
  { id: "R-03", name: "Brute Force Threshold", attackType: "BRUTE_FORCE", enabled: true, description: "동일 IP에서 60초 내 로그인 실패 5회 이상" },
  { id: "R-04", name: "Path Traversal Guard", attackType: "PATH_TRAVERSAL", enabled: true, description: "../, 절대경로 등 경로 탈출 패턴 탐지" },
  { id: "R-05", name: "Known Scanner Signature", attackType: "SCANNING", enabled: true, description: "sqlmap, nikto 등 알려진 스캐너 User-Agent/시그니처" },
  { id: "R-06", name: "Unexpected Shell in Container", attackType: "SHELL_EXEC", enabled: true, description: "컨테이너 내 sh/bash/python 등 인터랙티브 프로세스 spawn" },
  { id: "R-07", name: "Privileged Container Creation", attackType: "PRIV_ESC", enabled: true, description: "특수 권한 컨테이너/호스트 마운트 생성 시도" },
  { id: "R-08", name: "C2 Beaconing Pattern", attackType: "C2_COMM", enabled: false, description: "Tor/알려진 C2 IP 대역으로 아웃바운드 연결 (현재 비활성화)" },
  { id: "R-09", name: "Sensitive File Access", attackType: "CRED_ACCESS", enabled: true, description: "/etc/shadow, 시크릿 파일 등 민감 경로 접근 시도" },
];
 
export function byRuleHits(events) {
  return RULES.map((r) => ({
    ...r,
    hits: events.filter((e) => e.attackType === r.attackType).length,
  })).sort((a, b) => b.hits - a.hits);
}
 