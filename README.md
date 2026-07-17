<div align="center">

# SENTINEL-OPS

**WAS · WAF · Falco · K8s Audit 로그를 실시간으로 수집하고 상관분석하여
공격을 하나의 인시던트로 재구성해 조기에 탐지하는 보안 관제(SIEM) 플랫폼**

</div>

---

## 목차

1. [Introduction](#1-introduction)
2. [Demo](#2-demo)
3. [Login Page](#3-login-page)
4. [Overview Page](#4-overview-page)
5. [Incident Page](#5-incident-page)
6. [Infrastructure Page](#6-infrastructure-page)
7. [Admin Page](#7-admin-page)
8. [WAF / WAS / Falco / K8s 계층 Page](#8-waf--was--falco--k8s-계층-page)
9. [System Architecture](#9-system-architecture)
10. [ERD](#10-erd)
11. [Tech Stack](#11-tech-stack)

---

## 1. Introduction

![SENTINEL-OPS Architecture Demo](docs/images/sentinel-ops-architecture-demo.gif)

컨테이너 환경에서는 하나의 공격이 여러 계층에 흩어진 흔적으로 남습니다. WAF가
페이로드를 한 번 막아내고, WAS 액세스 로그에는 정찰성 요청이 반복해서 찍히고,
Falco는 컨테이너 내부의 이상 행위를 잡아내고, K8s Audit 로그에는 권한 상승
시도가 남습니다. 각 로그를 따로 보면 사소해 보이는 이 흔적들을, **SENTINEL-OPS**는
하나의 파이프라인으로 모아 **시간·IP·계정·리소스 단위로 상관분석(correlation)**해서
"연결된 하나의 공격 시나리오"로 재구성합니다.

**핵심 기능**

- **4계층 로그 통합 수집**: WAS(애플리케이션 액세스 로그) · WAF(웹 방화벽 탐지) ·
  Falco(컨테이너 런타임 보안) · K8s Audit(클러스터 API 감사) 4개 이종 소스를
  OpenTelemetry(OTLP)로 실시간 수집
- **상관분석 엔진**: threshold(횟수 기반)·sequence(순서 기반) 두 방식의 시나리오
  룰 32종으로 개별 이벤트를 하나의 인시던트로 자동 병합, MITRE ATT&CK 전술/기법
  자동 태깅
- **실시간 대시보드**: KPI/로그량/지역별 공격 분포/인시던트 타임라인을 2초 주기로
  갱신, 위젯을 자유롭게 배치하는 커스텀 대시보드 지원
- **인시던트 운영 워크플로**: 상태 전이(`open → investigating → closed`), 탐지
  정오답 라벨링(verdict)으로 시나리오별 정밀도(precision) 추적, PDF/CSV 리포트
  내보내기
- **관리 기능**: 사용자/보호 대상/예외 IP 관리, 상관 시나리오 룰 on/off, IP 차단,
  Slack/Discord 알림, 데이터 보존 정책, Gemini 기반 AI 트렌드 리포트
- **폴리글랏 저장소**: PostgreSQL(메타데이터) · OpenSearch(검색) · ClickHouse(분석)
  · Redis(상태/세션) 4개 저장소를 역할별로 조합

---

## 2. Demo

> 🎬 실제 대시보드 사용 화면 녹화본 자리 — 위 Introduction의 아키텍처 소개 GIF와는
> 별개로, 로그인부터 Overview/Incident/Infrastructure를 훑는 실제 화면 녹화(GIF
> 또는 mp4)를 추천합니다.

```md
![Demo](docs/images/demo.gif)
```

**GitHub에 GIF/영상 넣는 법**: 파일 크기가 크면(수십 MB) 웹 UI의 "파일 끌어다 놓기"가
잘 안 먹히는 경우가 많습니다 — 그 방식은 이슈/PR 댓글창 전용이고, 레포 파일 자체를
편집하는 화면에는 적용이 안 됩니다. 아래 방법이 가장 확실합니다.

1. GIF/mp4 파일을 저장소 안(`docs/images/`)에 실제로 넣고 커밋합니다.
   ```bash
   cp ~/Downloads/my-demo.gif docs/images/demo.gif
   git add docs/images/demo.gif
   git commit -m "docs: 데모 GIF 추가"
   git push origin main
   ```
2. README에서는 그 파일을 **레포 안 상대 경로**로 참조합니다 (외부 URL이 아니라
   `docs/images/demo.gif`처럼). 이 문서의 Introduction 섹션에 있는 GIF도 같은
   방식으로 넣었습니다 (`docs/images/sentinel-ops-architecture-demo.gif`).
3. GitHub는 100MB가 넘는 파일은 일반 `git push`로 올릴 수 없습니다(50MB부터 경고).
   영상이 너무 크면 GIF 대신 mp4로 두고 README에는 썸네일 이미지에 mp4 링크를 걸거나,
   GIF 자체를 압축(예: `ffmpeg`로 해상도/프레임레이트 낮추기)해서 크기를 줄이세요.

---

## 3. Login Page

서비스 소개 온보딩 영상이 끝나면 로그인 화면으로 전환됩니다. 아이디/비밀번호로
로그인하면 `platform-api`가 발급한 토큰을 프론트가 직접 들고 다니며 이후 모든
API 요청에 실어 보냅니다. 계정은 `admin`(읽기/쓰기 전권) · `viewer`(읽기 전용)
두 역할로 구분되고, 실제 권한 강제는 애플리케이션이 아니라 앞단의 Traefik이
담당합니다.

> 🖼️ 스크린샷 자리
>
> ```md
> ![Login Page](docs/images/login.png)
> ```

---

## 4. Overview Page

전체 보안 현황을 한눈에 보는 첫 화면입니다.

- KPI 카드(전체 로그 수, 에러/경고 비율, 활성 탐지 소스 수) — 직전 동일 구간 대비
  증감률 표시
- Log Volume / Log Level 추이 차트(막대·영역 전환 가능, 5색 구분)
- 탐지 소스별·심각도별 도넛 차트
- GeoIP 기반 공격 발원지 지도(Google Maps 연동)
- Top Source IPs, 실시간 이벤트 티커, 상관 흐름(Activity Flow) 위젯
- Recent Logs 테이블 + DQL 검색바(레벨·소스·키워드 조합 검색)
- 기본 모드 외에, 위젯을 자유롭게 배치·저장할 수 있는 커스텀 대시보드 모드 지원

> 🖼️ 스크린샷 자리
>
> ```md
> ![Overview Page](docs/images/overview.png)
> ```

---

## 5. Incident Page

상관분석 엔진이 발화시킨 인시던트를 관리하는 화면입니다.

- 인시던트 리스트 (상태: `open` → `investigating` → `closed` 선형 전이)
- 공격 스토리라인(타임라인) — 인시던트에 묶인 원본 이벤트를 시간순으로 재구성
- MITRE ATT&CK 전술/기법 태깅 및 [ATT&CK 매트릭스](#) 드릴다운 연동
- 정오답 라벨링(`verdict: true_positive / false_positive`) — 시나리오별
  탐지 정밀도(precision) 산출에 사용
- TOP 상관 규칙 / TOP 공격 IP / 최근 7일 주요 시그널 카드
- 인시던트 리포트 PDF/CSV 내보내기

> 🖼️ 스크린샷 자리
>
> ```md
> ![Incident Page](docs/images/incident.png)
> ```

---

## 6. Infrastructure Page

수집 파이프라인 자체의 건강 상태와 보호 대상 인프라 구조를 보여주는 화면입니다.

- K8s 클러스터 구조(네임스페이스/워크로드) 시각화
- 파이프라인 상태 패널 — Kafka 컨슈머 랙, DLQ 적재량, 수집 지연(clock skew)
- 계층별(모듈별) 로그량 추이 적층 그래프, 히트맵
- 네임스페이스/리소스별 탐지 랭킹

> 🖼️ 스크린샷 자리
>
> ```md
> ![Infrastructure Page](docs/images/infrastructure.png)
> ```

---

## 7. Admin Page

운영·관리 기능을 모아둔 화면입니다.

- 사용자 계정 CRUD (`admin`/`viewer`), 보호 대상(target)·예외 IP(allow-list) 관리
- 상관 시나리오 룰 32종 조회/랭킹/on-off 토글, 시나리오별 탐지 정밀도 확인
- IP 차단 이력 관리(차단/해제, 감사 로그 기록)
- 관리자 행위 감사 로그(Audit Log)
- Slack/Discord 알림 설정, 데이터 보존 정책(로그 보존 기간/등급), 폴링 주기 설정,
  대시보드 폰트 설정

> 🖼️ 스크린샷 자리
>
> ```md
> ![Admin Page](docs/images/admin.png)
> ```

---

## 8. WAF / WAS / Falco / K8s 계층 Page

4개 로그 소스별 상세 뷰입니다. 각 계층 전용 KPI, 로그량 추이, 실시간 로그 목록을
제공하며, 이벤트를 드릴다운하면 해당 로그가 발생한 Pod/Namespace 같은 K8s 컨텍스트
까지 함께 확인할 수 있습니다.

| 페이지 | 설명 |
| --- | --- |
| **WAF** | 웹 방화벽 탐지 로그 — 공격 유형(`attack_type`), 위험도, 차단 여부, 매칭 규칙 |
| **WAS** | 애플리케이션 액세스 로그 — 응답 상태/지연시간(p50/p90/p99), 엔드포인트별 트래픽 |
| **Falco** | 컨테이너 런타임 보안 이벤트 — 룰 이름, 프로세스/컨테이너 컨텍스트 |
| **K8s Audit** | 클러스터 API 감사 로그 — verb/리소스, RBAC 변경, 인증 주체(user/service account) |

> 🖼️ 스크린샷 자리 (4장)
>
> ```md
> ![WAF Page](docs/images/waf.png)
> ![WAS Page](docs/images/was.png)
> ![Falco Page](docs/images/falco.png)
> ![K8s Audit Page](docs/images/k8s-audit.png)
> ```

---

## 9. System Architecture

> 🖼️ 아키텍처 다이어그램 자리
>
> ```md
> ![System Architecture](docs/images/architecture.png)
> ```

```
Target 서버(mysite)
  │  OTLP(gRPC/HTTP)
  ▼
Traefik  ──▶  otel-collector  ──▶  Kafka (소스별 토픽: events.was/waf/falco/audit)
                                      │
                                      ▼
                              servers/normalizer
                    dedupe(Redis) → 파싱(4종) → 정규화(ECS) → GeoIP enrichment
                                      │
                                      ▼
                          Kafka 토픽: events.normalized
                     ┌────────────────┼─────────────────────┐
                     ▼                ▼                      ▼
        correlation-engine     Data Prepper            ClickHouse
      (시나리오 룰 32종 평가)   (OpenSearch 색인)      (Kafka 엔진 → 컬럼 분석)
                     │
                     ▼
        PostgreSQL (incidents / incident_events)
                     │
                     ▼
              servers/platform-api  ◀── Traefik(:80/api, 인증 게이트) ◀── Dashboard(React)
                     │
                     ▼
          Slack / Discord Webhook (인시던트 알림)
```

- **수집**: 보호 대상 서버의 WAS/WAF/Falco/K8s Audit 로그가 OTLP로 Traefik →
  otel-collector에 도달하고, `log.source` 리소스 속성 기준으로 Kafka 소스별
  토픽으로 라우팅됩니다.
- **정규화**: `normalizer`가 중복 제거(Redis) → 소스별 파싱 → ECS 점 표기 정규화
  → GeoIP/오케스트레이터 메타데이터 보강을 거쳐 `events.normalized` 토픽으로
  통합 스키마(NormalizedEvent)를 발행합니다.
- **상관분석**: `correlation-engine`이 이 통합 스트림을 threshold/sequence 룰로
  실시간 평가해 조건이 맞으면 인시던트를 생성/병합하고, MITRE ATT&CK 전술을
  자동으로 태깅해 PostgreSQL에 저장합니다.
- **저장/검색**: 같은 스트림이 동시에 Data Prepper를 거쳐 OpenSearch(검색/포렌식),
  ClickHouse(대량 로그 컬럼형 분석)에도 적재됩니다.
- **서빙**: `platform-api`가 Traefik(`/api/*`, forwardAuth 인증 게이트)을 통해서만
  대시보드와 통신하며, 인시던트는 실시간 폴링(2~5초)으로 프론트에 반영됩니다.

---

## 10. ERD

> 🖼️ ERD 다이어그램 자리
>
> ```md
> ![ERD](docs/images/erd.png)
> ```

PostgreSQL이 보안 운영에 필요한 메타데이터(계정/보호대상/룰/인시던트/감사로그)를
관계형으로 관리합니다. 원본 로그 자체는 OpenSearch/ClickHouse에 있고, PostgreSQL은
그 로그들을 참조(`event_id` 문자열 참조 — 저장소가 달라 FK는 걸지 않음)하는
운영 계층입니다.

| 테이블 | 역할 | 주요 관계 |
| --- | --- | --- |
| `users` | 관리자 계정 (`admin` / `viewer`) | — |
| `targets` | 보호 대상 애플리케이션 | `allow_list.target_id`가 참조 |
| `allow_list` | 예외 IP/대역 (전역 또는 target 스코프) | `targets`를 FK로 참조 |
| `scenario_rules` | 상관분석 시나리오 룰 (YAML이 source of truth, DB는 sync 대상) | `incidents.matched_scenario_rule_id`가 참조 |
| `incidents` | 상관분석으로 묶인 보안 사고 (상태/정오답 라벨) | `scenario_rules`, `users`(verdict_by)를 FK로 참조 |
| `incident_events` | 인시던트 ↔ 원본 이벤트 매핑 | `incidents`를 FK로 참조 (event_id는 OpenSearch/ClickHouse 참조용 문자열) |
| `banned_ips` | IP 차단 이력(감사 트레일) | `users`(created_by)를 FK로 참조 |
| `audit_logs` | 관리자 행위 감사 로그 | `users`를 FK로 참조 (ON DELETE SET NULL) |
| `alert_configs` | Slack/Discord 알림 설정 | `users`(created_by)를 FK로 참조 |
| `log_policies` | 로그 보존 기간/등급 정책 | `users`(created_by)를 FK로 참조 |
| `poll_intervals` | 대시보드 폴링 주기 설정 | — |
| `ai_trend_report_cache` | AI 트렌드 리포트 캐시 | — |

`incidents.status`는 `open → investigating → closed` 선형 전이만 허용하고,
`incidents.verdict`(`true_positive`/`false_positive`)는 이 상태와 완전히 별개
축으로 언제든 재설정할 수 있습니다. 스키마 상세는
[`servers/datastore/postgres/init/`](servers/datastore/postgres/init) 참고.

---

## 11. Tech Stack

### Frontend

| 항목 | 스택 |
| --- | --- |
| 프레임워크 | React 18 + Vite |
| 스타일링 | Tailwind CSS |
| 차트 | Recharts |
| 대시보드 레이아웃 | react-grid-layout (드래그 앤 드롭 커스텀 위젯) |
| 지도/3D | Google Maps API, Three.js |
| 리포트 | jsPDF (인시던트 PDF/CSV 내보내기) |
| 온보딩/데모 영상 | Remotion (React 기반 프로그래매틱 영상 생성) |
| 배포 | Vercel |

### Backend

| 항목 | 스택 |
| --- | --- |
| 언어/런타임 | Python 3.11 |
| 프레임워크 | FastAPI + Pydantic v2 |
| 비동기 드라이버 | asyncpg(PostgreSQL), aiokafka(Kafka), redis-py, opensearch-py(async), clickhouse-connect |
| GeoIP | geoip2 + MaxMind GeoLite2-City |
| AI 리포트 | google-genai (Gemini API) |
| 서비스 구성 | `normalizer` · `correlation-engine` · `platform-api` (마이크로서비스, `ids_shared` 공용 스키마 패키지 공유) |

### DB / Storage (Polyglot Persistence)

| 저장소 | 역할 |
| --- | --- |
| PostgreSQL 16 | 계정/룰/인시던트 등 관계형 메타데이터 (무결성/FK 보장) |
| OpenSearch 2.19 + Data Prepper 2.16 | 정규화 이벤트 검색·집계, 원본 포렌식 인덱스 |
| ClickHouse 26.4 | 대량 로그 컬럼형 분석 (Kafka 엔진 직결, Top-N 집계) |
| Redis 7 | 중복 제거, 상관분석 윈도우/쿨다운 상태, 로그인 세션 |

### DevOps / Infra

| 항목 | 스택 |
| --- | --- |
| 컨테이너 오케스트레이션 | Docker Compose (백엔드 전체), k3d + Helm (로컬 K8s, Falco/Audit 로그 소스) |
| 리버스 프록시 | Traefik v3 (단일 진입점, gRPC h2c 라우팅, forwardAuth 인증 게이트, ACME/Let's Encrypt) |
| 런타임 보안 | Falco |
| 오케스트레이션 스크립트 | Makefile (`make up` / `make down`) |

### Monitoring / Observability

| 항목 | 스택 |
| --- | --- |
| 로그 수집 | OpenTelemetry Collector (OTLP 수신 + `log.source` 기준 라우팅) |
| 이벤트 스트리밍 | Apache Kafka (KRaft 단일 노드, 소스별 토픽 분리) |
| 파이프라인 헬스 | 컨슈머 랙 / DLQ 깊이 / 수집 지연(clock skew) 자체 계측 |
| 알림 | Slack / Discord Webhook |

### Auth

| 항목 | 방식 |
| --- | --- |
| 인증 강제 지점 | Traefik forwardAuth (`platform-api` 앱이 아니라 프록시 레벨에서 게이트) |
| 세션 | 토큰 기반 (Redis에 세션 저장, 쿠키 아님) |
| 비밀번호 해시 | PostgreSQL `pgcrypto` |
| 권한 모델 | `admin`(읽기/쓰기) / `viewer`(읽기 전용) |

---

## 더 보기

데이터 정규화 계약, 전체 REST API 명세, 저장소별 스키마 상세, 트러블슈팅 기록 등
백엔드 구현 디테일은 [`docs/BACKEND_ENGINEERING_NOTES.md`](docs/BACKEND_ENGINEERING_NOTES.md)에
따로 정리되어 있습니다.
