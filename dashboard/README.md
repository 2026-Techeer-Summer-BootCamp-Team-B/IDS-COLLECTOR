# IDS Dashboard (SENTINEL-OPS)

IDS-COLLECTOR가 수집한 로그(WAS / Falco / K8s Audit)를 보여주는 프론트엔드. 지금은 전부 목업 데이터(`src/data/`)로 동작하며, 실데이터 연동은 백엔드에 조회 API가 추가된 이후 진행 예정.

## 실행

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/ 생성
```

## 폴더 구조

```
src/
├── App.jsx           앱 셸 — 사이드바, 탑바, 탭 전환, 라이브 피드/토스트/크리티컬 팝업 상태
├── main.jsx           entry point
├── views/              사이드바 탭 하나당 파일 하나
│   ├── LogDashboard.jsx    (Overview)
│   ├── IncidentsView.jsx
│   ├── AttackMatrixView.jsx
│   ├── InfrastructureView.jsx
│   └── AdminAuditView.jsx
├── components/          여러 화면에서 재사용하는 공용 UI
│   ├── badges.jsx          SeverityBadge / SourceBadge / StatusDot
│   ├── LiveTicker.jsx       하단 실시간 이벤트 마퀴
│   ├── CriticalAlertPopup.jsx  CRITICAL 탐지 시 우상단 팝업
│   ├── ToastStack.jsx        조치 완료 등 액션 피드백 토스트
│   └── WorldMap.jsx          GeoIP 공격 발원지 지도
├── data/                목업 데이터 + 순수 집계 함수 (실데이터 연동 시 이 레이어만 교체)
│   ├── mockLogs.js, logLevels.js, timeSeries.js   (Overview용)
│   ├── attackEvents.js                             (SOC 4개 화면이 공유하는 단일 이벤트 소스)
│   ├── incidents.js, attackMatrix.js, rules.js, auditLog.js
└── hooks/
    └── useLiveFeed.js     ATTACK_EVENTS를 재생해 실시간처럼 보이게 하는 훅
```

## 화면 구성

좌측 사이드바(`App.jsx`)로 화면을 전환. 상단 통계바에는 진행중 Incident / 총 Detected / 오픈 Alert / 총 Blocked 수치와 LIVE 시계, 하단에는 실시간 이벤트 티커가 항상 떠 있음.

### Overview — `views/LogDashboard.jsx`
- KPI 카드, 기간별(15분~30일) 로그 볼륨 추이, 레벨 분포, Top 소스, 에러율 게이지, 최근 로그 테이블

### Incidents — `views/IncidentsView.jsx`
- 오늘 탐지/차단 수 + Top 공격유형/IP KPI, 공격 유형·탐지 소스 도넛 차트
- 최근 차단/탐지 로그 테이블 (미차단 건은 그 자리에서 "차단" 처리 가능)
- 좌측 인시던트 리스트 + 우측 상세(상관 규칙/MITRE 경로/공격 스토리라인 타임라인), "조사완료" 처리 가능

### ATT&CK — `views/AttackMatrixView.jsx`
- MITRE ATT&CK 전술 컬럼 × 기법 카드(탐지 시 mint 강조), 클릭 시 하단에 매칭 로그, 전체 커버리지 표시

### Infrastructure — `views/InfrastructureView.jsx`
- Top 공격 대상(namespace/pod) 랭킹, 네임스페이스별 클러스터 구조, GeoIP 공격 발원지 지도(`WorldMap`)

### Admin / Audit — `views/AdminAuditView.jsx`
- 탐지 룰별 적중 랭킹, Audit Log(누가/언제/어떤 조치를 했는지 — Incidents/Infrastructure에서의 조치가 여기 실시간으로 쌓임)

## 색상
`tailwind.config.js`의 `dash.*` 토큰 사용. 원본 팔레트(bg/surface/mint/pink 등)는 참조 팔레트 그대로이고, `critical`/`high`/`medium`/`live`/`was`는 심각도·소스 구분을 위해 이 프로젝트에서 추가한 색.
