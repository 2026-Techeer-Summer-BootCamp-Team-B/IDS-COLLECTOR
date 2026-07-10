// Seed data for the Admin/Audit tab's AuditLog table (시각/사용자/액션/대상/IP).
// New entries get prepended at runtime from App.jsx whenever a "fake response
// action" (블록/조사완료 버튼) fires — see App.jsx's `logAction`.
 
export const SEED_AUDIT_LOG = [
  { id: 1, timestamp: new Date("2026-07-10T13:58:00"), user: "이수민", action: "룰 비활성화: C2 Beaconing Pattern", target: "R-08", ip: "10.0.4.12" },
  { id: 2, timestamp: new Date("2026-07-10T12:41:00"), user: "system", action: "IP 자동 차단", target: "juice-shop-7d9f", ip: "45.83.521.6" },
  { id: 3, timestamp: new Date("2026-07-10T11:02:00"), user: "박지훈", action: "인시던트 조사 완료 처리 (INC-2030)", target: "juice-shop-7d9f", ip: "185.107.56.12" },
  { id: 4, timestamp: new Date("2026-07-10T09:15:00"), user: "system", action: "룰 임계값 조정: Brute Force Threshold", target: "R-03", ip: "10.0.4.12" },
  { id: 5, timestamp: new Date("2026-07-09T22:30:00"), user: "이수민", action: "관리자 로그인", target: "SENTINEL-OPS Console", ip: "10.0.1.4" },
];