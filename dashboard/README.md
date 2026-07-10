# IDS Dashboard (SENTINEL-OPS)

IDS-COLLECTOR가 수집한 로그(WAF / Falco / K8s Audit)를 보여주는 프론트엔드. 지금은 전부 목업 데이터(`src/mockLogs.js`, `src/incidents.js`, `src/attackMatrix.js`)로 동작하며, 실데이터 연동은 백엔드에 조회 API가 추가된 이후 진행 예정.

## 실행

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/ 생성
```

## 화면 구성

좌측 사이드바(`src/App.jsx`)로 화면을 전환하는 구조. 상단 통계바에는 진행중 Incident / 총 Detected / 오픈 Alert / 총 Blocked 수치와 LIVE 시계가 항상 떠 있음.

### Overview
`src/LogDashboard.jsx` (`DashboardContent`)

- KPI 카드: 12시간 총 로그 수 / 에러 수 / 경고 수 / 활성 소스 수
- 로그 볼륨 추이(이번 주 vs 지난 주), 최근 12시간 레벨 분포, 최근 30일 로그량 라인 차트
- Top 로그 소스 랭킹, 에러율 게이지
- 최근 로그 테이블 (레벨/소스/메시지 필터 검색)

### Incidents
`src/IncidentsView.jsx`

- 좌측: 인시던트 리스트. 카드 왼쪽 컬러 바로 심각도(CRITICAL/HIGH/MEDIUM/LOW) 표시, 진행중/조사완료 상태 점 표시
- 우측: 선택한 인시던트 상세 — 상관 규칙, MITRE ATT&CK 경로, 위험 신호 요약
- 하단: 공격 스토리라인 — WAF/Falco/K8s Audit 로그를 시간순으로 엮은 타임라인 (오프셋, 소스, MITRE 기법 태그 포함)

### ATT&CK
`src/AttackMatrixView.jsx`

- MITRE ATT&CK 전술(Tactic) 13개를 컬럼으로, 각 컬럼 안에 기법(Technique) 카드 배치
- 실제 탐지된 기법은 mint 색으로 강조 + hit 수 표시, 미탐지 기법은 흐리게
- 기법 카드를 클릭하면 하단에 해당 기법으로 매칭된 로그 목록이 뜸
- 상단에 전체 커버리지(탐지된 기법 수 / 전체 기법 수, %) 표시

### Infrastructure / Admin·Audit
아직 목업이 없어 자리만 잡아둔 화면(`Placeholder` 컴포넌트). 화면 설계가 나오면 채울 예정.

## 공용 컴포넌트
`src/badges.jsx`

- `SeverityBadge`: CRITICAL/HIGH/MEDIUM/LOW 뱃지
- `SourceBadge`: WAF/Falco/K8s Audit 소스 뱃지
- `StatusDot`: 진행중(빨강)/조사완료(초록) 상태 점

## 색상
`tailwind.config.js`의 `dash.*` 토큰 사용. 원본 팔레트(bg/surface/mint/pink 등)는 참조 팔레트 그대로이고, `critical`/`high`/`medium`/`live`/`waf`는 심각도·소스 구분을 위해 이 프로젝트에서 추가한 색.
