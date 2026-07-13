// Data policy config for the Admin/Audit tab's "데이터 정책" section —
// addresses the "노이즈 처리" question from the logging-tool selection
// framework (샘플링 / 제외 규칙 / 보존 tier). Kept as plain editable state
// (not derived from event data) since in a real deployment this maps 1:1
// to Fluent Bit/Vector filter config + index lifecycle policy, not
// something you compute from the logs themselves.

// 계층별 보존 정책 기본값. hotDays: 즉시 쿼리 가능한 hot tier(OpenSearch) 보존일,
// coldDays: 압축 아카이브(cold/archive tier, 예: S3+Parquet) 보존일,
// samplingRate: 저장 전 샘플링 비율(%) — Falco는 기본적으로 노이즈가 많아 낮게 잡음.
export const INITIAL_LOG_POLICIES = [
  { layer: "WAS", hotDays: 7, coldDays: 90, samplingRate: 100, archiveEnabled: true },
  { layer: "Falco", hotDays: 3, coldDays: 30, samplingRate: 20, archiveEnabled: true },
  { layer: "K8s Audit", hotDays: 14, coldDays: 180, samplingRate: 100, archiveEnabled: true },
];

// 제외(exclusion) 규칙 — 파이프라인 단계(Fluent Bit/Vector transform)에서 걸러낼
// 저가치 노이즈 패턴. estimatedReductionPct는 해당 규칙이 활성화됐을 때 해당
// 계층 전체 로그량에서 줄어드는 대략적인 비중(데모용 추정치).
export const INITIAL_EXCLUSION_RULES = [
  {
    id: "EX-01",
    layer: "Falco",
    pattern: 'rule="Contact K8S API Server From Container"',
    reason: "정상 컨트롤러 트래픽 — 전체 Falco 이벤트의 절반 이상을 차지하는 저가치 NOTICE 노이즈",
    estimatedReductionPct: 55,
    enabled: true,
  },
  {
    id: "EX-02",
    layer: "K8s Audit",
    pattern: 'verb IN (get, watch) AND user =~ "system:serviceaccount:.*"',
    reason: "서비스어카운트의 routine reconcile 호출 — 보안 신호 아님",
    estimatedReductionPct: 40,
    enabled: true,
  },
  {
    id: "EX-03",
    layer: "WAS",
    pattern: 'path="/api/v1/health"',
    reason: "헬스체크 폴링 — 초 단위 반복 호출로 로그량만 증가",
    estimatedReductionPct: 8,
    enabled: true,
  },
  {
    id: "EX-04",
    layer: "Falco",
    pattern: 'level=DEBUG AND source="collector"',
    reason: "디버그 빌드 잔재 로그",
    estimatedReductionPct: 3,
    enabled: false,
  },
];
