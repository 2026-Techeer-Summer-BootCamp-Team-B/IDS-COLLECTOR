<!--
Organization Profile README
경로: 2026-Techeer-Summer-BootCamp-Team-B/.github/profile/README.md

권장 이미지 경로: .github/profile/assets/
logo.png, hero.gif, demo.gif, architecture.png, erd.png,
overview.png, incident.png, infrastructure.png, admin.png,
waf.png, was.png, falco.png, k8s-audit.png
-->

<div align="center">


<img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/sentinel-ops-logo-512.png" width="70" alt="SENTINEL-OPS Logo" /> 

# SENTINEL-OPS


### 흩어진 보안 로그를 연결된 하나의 공격 시나리오로 재구성하는 실시간 SIEM 플랫폼


WAS · WAF · Falco · Kubernetes Audit 로그를 실시간으로 수집하고,<br/>
시간 · IP · 계정 · 리소스 기반 상관분석으로 위협을 조기에 탐지합니다.

<br/>

<p>
  <img src="https://img.shields.io/badge/OpenTelemetry-000000?style=for-the-badge&logo=opentelemetry&logoColor=white" alt="OpenTelemetry" />
  <img src="https://img.shields.io/badge/Apache_Kafka-231F20?style=for-the-badge&logo=apachekafka&logoColor=white" alt="Apache Kafka" />
  <img src="https://img.shields.io/badge/Kubernetes-326CE5?style=for-the-badge&logo=kubernetes&logoColor=white" alt="Kubernetes" />
  <img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/Falco-00AEC7?style=for-the-badge&logo=falco&logoColor=white" alt="Falco" />
  <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
</p>

<p>
  <a href="https://dashboard-phi-ten.vercel.app/"><b>🚀 Live Demo</b></a> ·
  <a href="https://app.notion.com/p/Techeer-12th-B-team-38ecc8a8704080ab8bd8d238da3e999c?source=copy_link"><b>✏️ Team Notion</b></a> ·
  <a href="https://medium.com/@yongwook0001/siliconvalley-bootcamp-team-b-sentinel-ops-f6b68e3c93b7"><b>📝 Medium Blog</b></a>
</p>

<p>
  <a href="https://github.com/2026-Techeer-Summer-BootCamp-Team-B/IDS-COLLECTOR"><b>📦 Central SIEM 저장소</b></a> ·
  <a href="https://github.com/2026-Techeer-Summer-BootCamp-Team-B/Techeer-12th-b"><b>🖥️ Target 서버 저장소</b></a>
</p>

</div>

---

## 📑 Table of Contents
- [🎯 Project Overview](#-project-overview)
- [🎬 Demo](#-demo)
- [⚖️ Challenges & Solutions](#challenges-solutions)
- [✨ Key Features](#-key-features)
- [🚨 Attack Detection Scenario](#-attack-detection-scenario)
- [🖥️ Screenshots](#screenshots)
- [📗 API](#-api-상세-문서)
- [🏗️ System Architecture](#system-architecture)
- [🗃️ Data Architecture](#data-architecture)
- [🛠️ Tech Stack](#tech-stack)
- [📊 Monitoring](#monitoring)
- [📦 Repositories](#-repositories)
- [🧪 Live Demo](#-live-demo)
- [👥 Team B](#-team-members)
- [📚 Documentation](#-documentation)
  
---

## 🎯 Project Overview
<div align="center">
  
<img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/ArchTreeDemo.gif" width="950" alt="SENTINEL-OPS Architecture Demo" />

</div>

### 컨테이너 환경에서 하나의 공격은 여러 계층에 나뉜 흔적으로 남습니다.

- **WAF**에는 SQL Injection, XSS, Bad Bot과 같은 악성 요청이 남습니다.
- **WAS**에는 정찰성 요청과 비정상적인 엔드포인트 접근 기록이 남습니다.
- **Falco**에는 컨테이너 내부의 셸 실행, 민감 파일 접근, 권한 상승 행위가 남습니다.
- **Kubernetes Audit**에는 RBAC 변경, ServiceAccount 오용, 비정상 API 호출이 남습니다.

개별 로그만 보면 서로 관계없는 이벤트처럼 보일 수 있습니다. **SENTINEL-OPS**는 이 이벤트들을 OpenTelemetry 기반 파이프라인으로 수집·정규화하고, `시간 · IP · 계정 · 리소스` 관계를 분석하여 **하나의 연결된 인시던트**로 재구성합니다.


---

## 🎬 Demo

<div align="center">

<img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/DualMonitorTour.gif" width="950" alt="SENTINEL-OPS Page Demo" />




</div>

---


<a id="challenges-solutions"></a>
## ⚖️ Challenges & Solutions

| 기존 문제 | SENTINEL-OPS의 해결 방식 |
| --- | --- |
| 보안 이벤트가 애플리케이션·컨테이너·클러스터 계층에 분산됨 | WAS·WAF·Falco·K8s Audit 이벤트를 공통 스키마로 통합 |
| 단일 이벤트만으로 전체 공격 흐름을 파악하기 어려움 | Threshold·Sequence 기반 상관분석으로 연관 이벤트를 인시던트로 병합 |
| 탐지 이후 분석과 대응이 수작업으로 진행됨 | MITRE ATT&CK 태깅, AI 리포트, Slack·Discord 알림 제공 |
| 로그 검색·대량 분석·운영 데이터의 저장 요구가 서로 다름 | PostgreSQL·OpenSearch·ClickHouse·Redis를 역할별로 분리 |

---

## ✨ Key Features

<table width="100%">
  <tr>
    <td width="33%" valign="top">

### 🔭 다계층 로그 통합 수집

- WAS 액세스 로그
- 자체 개발 FastAPI WAF 탐지 로그
- Falco 런타임 보안 이벤트
- Kubernetes Audit 로그
- OpenTelemetry OTLP 기반 실시간 전달

</td>

<td width="33%" valign="top">

### 🧩 시나리오 상관분석

- Threshold·Sequence 룰 지원
- 109종 상관분석 시나리오 (8개 카테고리)
- MITRE ATT&CK for Containers 근거 기반
- 이벤트 자동 생성·병합
- 시간·IP·계정·리소스 관계 분석

</td>

<td width="33%" valign="top">

### 📊 실시간 보안 대시보드

- 보안 KPI 및 로그 추이
- GeoIP 기반 공격 발원지 지도
- 인시던트 공격 스토리라인
- 실시간 이벤트 및 Activity Flow
- DQL 기반 로그 검색
- 드래그 앤 드롭 커스텀 위젯

</td>
  </tr>

  <tr>
    <td valign="top">

### 🚨 인시던트 운영 및 대응

- `open → investigating → closed`
- True / False Positive 판정
- IP 차단·해제 및 감사 이력
- Critical 등급 실시간 알림
- PDF·CSV 인시던트 리포트

</td>

<td valign="top">

### 🤖 AI 보안 리포트

- Gemini 기반 탐지 트렌드 요약
- 공격 흐름 및 영향 분석
- 권장 대응 방안 생성
- 일간·주간 리포트
- Slack·Discord 연동

</td>

<td valign="top">

### 🛡️ Target 보안 노드

- OWASP Juice Shop 기반 테스트 환경
- Detection / Prevention WAF
- SQLi · XSS · Command Injection · Path Traversal 탐지
- Bad Bot · Rate Limiting · Brute Force · CORS 위반 탐지
- Falco · K8s Audit · WAS 로그 중앙 전송

</td>
  </tr>
</table>



---

## 🚨 Attack Detection Scenario

| 탐지 계층 | 탐지 이벤트 |
| --- | --- |
| 🌐 WAF | SQL Injection 페이로드 탐지 |
| 📄 WAS | 동일 IP의 반복적인 인증 우회 요청 |
| 📦 Falco | 컨테이너 내부 비정상 셸 실행 |
| ☸️ K8s Audit | ServiceAccount 권한 변경 시도 |
| 🔗 SIEM | 시간·IP·리소스 기반 이벤트 상관분석 |
| 📢 Response | Critical 인시던트 생성 및 Slack 알림 |

> 개별적으로 분리된 4개 보안 이벤트를 하나의 Critical 인시던트로 재구성합니다.
<a id="screenshots"></a>

---

## 🖥️ Screenshots

### Overview

전체 로그 수, 위험도, 활성 탐지 소스, 공격 발원지, 최근 이벤트와 상관 흐름을 한 화면에서 확인합니다.

<div align="center">
  <img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/OverviewDemo.gif" width="950" alt="Overview Dashboard" />
</div>
<br/>

### Incident

연관 이벤트를 시간순 공격 스토리라인으로 확인하고, MITRE ATT&CK 태그·상태·정오답 판정을 관리합니다.
<div align="center">
  <img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/IncidentDemo.gif" width="950" alt="Incident Dashboard" />
</div>
<br/>

### ATT&CK

MITRE ATT&CK 전술/기법 매트릭스를 확인하고, 셀을 클릭하면 해당 기법에서 탐지된 실제 인시던트 목록을 조회할 수 있습니다.

<div align="center">
  <img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/AttackDemo.gif" width="950" alt="ATT&CK Dashboard" />
</div>
<br/>


### Infrastructure & Admin / Audit

Kubernetes 클러스터 구조와 Kafka Consumer Lag, DLQ, 수집 지연 등 전체 보안 파이프라인의 상태를 확인하고, 사용자·보호 대상·예외 IP·시나리오 룰·알림 등급·보존 정책을 통합 관리합니다.

<div align="center">
  <img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/InfraAdminDemo.gif" width="950" alt="Infrastructure and Admin Dashboard" />
</div>
<br/>

### Attack Map

GeoIP 기반으로 공격 발원지를 지도에서 확인합니다.

<div align="center">
  <img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/MapDemo.gif" width="950" alt="Attack Map" />
</div>
<br/>

### Custom Dashboard

드래그 앤 드롭으로 위젯을 배치해 나만의 대시보드를 구성합니다.

<div align="center">
  <img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/CustomDemo.gif" width="950" alt="Custom Dashboard" />
</div>
<br/>

### 로그 수집 방법

SENTINEL-OPS가 로그를 수집하는 방법은 두 가지입니다.

1. **Juice Shop 직접 공격** — Kubernetes 내에 배포된 [OWASP Juice Shop](https://owasp.org/www-project-juice-shop/)은 임의로 해킹이 가능하도록 취약점을 심어둔 웹 애플리케이션입니다. 이 사이트에서 마우스 클릭 몇 번만으로도 SQLi·XSS 등의 공격을 수행할 수 있고, 그 즉시 WAF·WAS·Falco·K8s Audit 로그가 수집됩니다.
2. **공격 더미 생성기 사용** — 저희가 직접 만든 공격 더미 생성기로 다양한 공격 시나리오를 원클릭으로 발생시켜 로그를 수집할 수 있습니다.

<p align="center">
<img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/JuiceShopDemo.gif" width="48%" alt="Juice Shop Attack Demo" />
<img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/DummyGeneratorDemo.gif" width="48%" alt="Attack Dummy Generator Demo" />
</p>



## 🌐 WAF / 📄 WAS / 📦 Falco / ☸️ K8s Audit

각 보안 계층에서 수집된 이벤트의 탐지 정보와 운영 지표를 상세 화면에서 확인할 수 있습니다.

<details>
<summary><b>상세 화면</b></summary>
<br/>
 

| 화면 | 주요 정보 |
| --- | --- |
| **WAF** | 공격 유형, 위험도, 탐지·차단 여부, 매칭 규칙 |
| **WAS** | 응답 상태, 엔드포인트 트래픽, p50·p90·p99 지연시간 |
| **Falco** | 룰 이름, 프로세스, 컨테이너·Pod·Namespace 컨텍스트 |
| **K8s Audit** | Verb, 리소스, RBAC 변경, 사용자·ServiceAccount |

### WAF
<div align="center">
  <img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/WafDemo.gif" width="950" alt="WAF Page" />
</div>
<br/>

### WAS

<div align="center">
  <img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/WasDemo.gif" width="950" alt="WAS Page" />
</div>
<br/>

### FALCO

<div align="center">
  <img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/FalcoDemo.gif" width="950" alt="Falco Page" />
</div>
<br/>

### K8S Audit

<div align="center">
  <img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/K8sDemo.gif" width="950" alt="K8s Audit Page" />
</div>

</details>



---
## 📗 API [(상세 문서)](https://github.com/2026-Techeer-Summer-BootCamp-Team-B/IDS-COLLECTOR/blob/main/docs/BACKEND_ENGINEERING_NOTES.md#%ED%94%84%EB%A1%A0%ED%8A%B8%EC%97%94%EB%93%9C-%EC%97%B0%EB%8F%99-api)
주요 기능을 중심으로 정리한 대표 API입니다. 전체 API는 상세 문서에서 확인할 수 있습니다.
<img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/api1.png" width="950" alt="api1" />
<img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/api2.png" width="950" alt="api2" />
<img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/api3.png" width="950" alt="api3" />
<img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/api4.png" width="950" alt="api4" />

---

<a id="system-architecture"></a>
## 🏗️ System Architecture

<div align="center">
<img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/architecture.png" width="900" alt="SENTINEL-OPS System Architecture" />
</div>

<div align="center">
<img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/architecture-nonicon.png" width="900" alt="SENTINEL-OPS System Architecture" />
</div>


<details>
  
<summary><b>▶️ Architecture Flow</b></summary>

### Architecture Flow
1. **Detect & Collect** — Target 서버에서 WAF·WAS·Falco·K8s Audit 이벤트를 생성하고 OTel Collector로 수집합니다.
2. **Transfer** — Target Collector가 이벤트에 `log.source`를 부여하고 Central SIEM으로 OTLP 전송합니다.
3. **Normalize** — 중복 제거, 소스별 파싱, ECS 정규화, GeoIP·Kubernetes 메타데이터 보강을 수행합니다.
4. **Correlate** — Threshold·Sequence 시나리오를 평가해 연관 이벤트를 하나의 인시던트로 병합합니다.
5. **Store & Analyze** — PostgreSQL은 운영 데이터, OpenSearch는 검색·포렌식, ClickHouse는 대량 분석, Redis는 상태·세션을 담당합니다.
6. **Visualize & Notify** — FastAPI와 React 대시보드가 결과를 제공하고 AI 리포트 및 Slack·Discord 알림을 전송합니다.
<div align="center">
  <img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/infra_line.gif" width="950"
       alt="SENTINEL-OPS Architecture Flow" />
</div>

</details>

<details>
<summary><b>🔍 Detailed Processing Pipeline</b></summary>
<br/>

```text
[Target 플레인 — k3d 클러스터]
  Juice Shop (보호 대상)
  ├─ nginx 사이드카 ──── WAS raw access log
  ├─ FastAPI WAF 센서 ── 시그니처 탐지 alert (OTLP push)
  ├─ Falco (eBPF) ────── 커널 런타임 이벤트
  └─ K8s Audit Policy ── 컨트롤플레인 행위 기록
            │
            ▼  OTel Collector (filelog tail + OTLP 수신 → 태깅 → 중앙 전송)
            │
   ═════ OTLP gRPC ═════
            │
[Central SIEM 플레인 — GCP VM / docker-compose]
  Traefik (단일 진입점, forwardAuth 인증 게이트)
            ▼
  Gateway OTel Collector ──→ Kafka (소스별 토픽: events.was/waf/falco/audit)
            ▼
  Normalizer (dedupe → parse → 정규화 → 심각도 → enrich) ──→ events.normalized
            ▼                                    ▼
  Correlation Engine (시나리오 YAML)        Data Prepper → OpenSearch
            ▼                               Kafka Engine → ClickHouse
  PostgreSQL (인시던트)
            ▼
  Platform API (FastAPI, REST 폴링) ──→ React 대시보드
```
</details>

---

<a id="data-architecture"></a>
## 🗃️ Data Architecture

<div align="center">
<img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/erd.png" width="950" alt="SENTINEL-OPS ERD" />
</div>

| 저장소 | 역할 |
| --- | --- |
| **PostgreSQL 16** | 사용자, 보호 대상, 시나리오 룰, 인시던트, 차단·감사 이력 |
| **OpenSearch 2.19** | 정규화 이벤트 검색·집계 및 원본 포렌식 |
| **ClickHouse 26.4** | 대량 로그 컬럼형 분석과 Top-N 집계 |
| **Redis 7** | 중복 제거, 상관분석 윈도우·쿨다운, 로그인 세션 |

<details>
<summary><b>PostgreSQL 주요 테이블</b></summary>
<br/>

| 테이블 | 역할 |
| --- | --- |
| `users` | 관리자·조회자 계정 및 권한 |
| `targets` | 보호 대상 애플리케이션 |
| `allow_list` | 전역 또는 Target 단위 예외 IP |
| `scenario_rules` | 상관분석 시나리오 룰 |
| `incidents` | 보안 사고 상태·등급·판정 정보 |
| `incident_events` | 인시던트와 원본 이벤트 매핑 |
| `banned_ips` | IP 차단·해제 이력 |
| `audit_logs` | 관리자 행위 감사 로그 |
| `alert_configs` | Slack·Discord 알림 설정 |
| `log_policies` | 로그 등급별 보존 정책 |
| `ai_trend_report_cache` | AI 트렌드 리포트 캐시 |

</details>


---




<a id="tech-stack"></a>
## 🛠️ Tech Stack

### Frontend

<p>
<img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
<img src="https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
<img src="https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
<img src="https://img.shields.io/badge/Recharts-22B5BF?style=for-the-badge" alt="Recharts" />
<img src="https://img.shields.io/badge/Three.js-000000?style=for-the-badge&logo=threedotjs&logoColor=white" alt="Three.js" />
<img src="https://img.shields.io/badge/Google_Maps-4285F4?style=for-the-badge&logo=googlemaps&logoColor=white" alt="Google Maps" />
<img src="https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white" alt="Vercel" />
<img src="https://img.shields.io/badge/Remotion-000000?style=for-the-badge&logo=remotion&logoColor=white" alt="Remotion" />
</p>

### Backend & Streaming

<p>
<img src="https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python" />
<img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI" />
<img src="https://img.shields.io/badge/Pydantic-E92063?style=for-the-badge&logo=pydantic&logoColor=white" alt="Pydantic" />
<img src="https://img.shields.io/badge/Apache_Kafka-231F20?style=for-the-badge&logo=apachekafka&logoColor=white" alt="Kafka" />
<img src="https://img.shields.io/badge/OpenTelemetry-000000?style=for-the-badge&logo=opentelemetry&logoColor=white" alt="OpenTelemetry" />
</p>

### Database & Search

<p>
<img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL" />
<img src="https://img.shields.io/badge/OpenSearch-005EB8?style=for-the-badge&logo=opensearch&logoColor=white" alt="OpenSearch" />
<img src="https://img.shields.io/badge/ClickHouse-FFCC01?style=for-the-badge&logo=clickhouse&logoColor=black" alt="ClickHouse" />
<img src="https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white" alt="Redis" />
<img src="https://img.shields.io/badge/Data%20Prepper-005EB8?style=for-the-badge" alt="Data Prepper" />
</p>

### Infrastructure & Security

<p>
<img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" />
<img src="https://img.shields.io/badge/Kubernetes-326CE5?style=for-the-badge&logo=kubernetes&logoColor=white" alt="Kubernetes" />
<img src="https://img.shields.io/badge/Helm-0F1689?style=for-the-badge&logo=helm&logoColor=white" alt="Helm" />
<img src="https://img.shields.io/badge/Traefik-24A1C1?style=for-the-badge&logo=traefikproxy&logoColor=white" alt="Traefik" />
<img src="https://img.shields.io/badge/Falco-00AEC7?style=for-the-badge" alt="Falco" />
</p>

### Monitoring / Observability

<p>
<img src="https://img.shields.io/badge/Grafana-F46800?style=for-the-badge&logo=grafana&logoColor=white" alt="Grafana" />
<img src="https://img.shields.io/badge/Prometheus-E6522C?style=for-the-badge&logo=prometheus&logoColor=white" alt="Prometheus" />
<img src="https://img.shields.io/badge/Slack-4A154B?style=for-the-badge&logo=slack&logoColor=white" alt="Slack">
<img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord">
</p>

### AI
<p>
<img src="https://img.shields.io/badge/Gemini_API-8E75B2?style=for-the-badge&logo=googlegemini&logoColor=white" alt="Gemini API" />
</p>

### Security Testing
<p>
<img src="https://img.shields.io/badge/OWASP_Juice_Shop-000000?style=for-the-badge&logo=owasp&logoColor=white" alt="OWASP Juice Shop" />
</p>

### Development & Collaboration
<p>
<img src="https://img.shields.io/badge/Git-F05032?style=for-the-badge&logo=git&logoColor=white" alt="Git" />
<img src="https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white">
<img src="https://img.shields.io/badge/Notion-000000?style=for-the-badge&logo=notion&logoColor=white">
<img src="https://img.shields.io/badge/Zoom-2D8CFF?style=for-the-badge&logo=zoom&logoColor=white">
<img src="https://img.shields.io/badge/Figma-F24E1E?style=for-the-badge&logo=figma&logoColor=white">
</p>


---
<a id="monitoring"></a>

## 📊 Monitoring

<div align="center">
<img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/cadvisor-exporter.png" width="950" alt="User and Target Management Dashboard" />
  Cadvisor-exporter
</div>



<div align="center">
<img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/clickhouse.png" width="950" alt="User and Target Management Dashboard" />
  Clickhouse
</div>



<div align="center">
<img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/elasticsearch.png" width="950" alt="User and Target Management Dashboard" />
  Elasticsearch
</div>


<div align="center">
<img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/kafka.png" width="950" alt="User and Target Management Dashboard" />
  
  Kafka
</div>


<div align="center">
<img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/node-exporter.png" width="950" alt="User and Target Management Dashboard" />
  
  Node-Exporter
</div>

<div align="center">
<img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/postgre.png" width="950" alt="User and Target Management Dashboard" />
  
  Postgre
</div>

<div align="center">
<img src="https://raw.githubusercontent.com/2026-Techeer-Summer-BootCamp-Team-B/.github/main/profile/assets/prometheus.png" width="950" alt="User and Target Management Dashboard" />
  
  Prometheus
</div>





## 📦 Repositories

<table>
<tr>
<td width="50%" valign="top">

### [IDS-COLLECTOR](https://github.com/2026-Techeer-Summer-BootCamp-Team-B/IDS-COLLECTOR)

**Central SIEM · Main Monorepo**

다계층 로그 수집 게이트웨이, Kafka 스트리밍, 정규화, 시나리오 상관분석, 인시던트 관리, FastAPI API, React 대시보드, AI 리포트와 저장 계층을 포함합니다.

`React` `FastAPI` `Kafka` `OpenSearch` `ClickHouse` `PostgreSQL` `Redis`

</td>
<td width="50%" valign="top">

### [Techeer-12th-b](https://github.com/2026-Techeer-Summer-BootCamp-Team-B/Techeer-12th-b)

**Target Security Node**

OWASP Juice Shop을 보호 대상으로 구성하고, 자체 FastAPI WAF·WAS·Falco·K8s Audit 로그를 생성·수집하여 Central SIEM으로 OTLP 전송합니다.

`FastAPI WAF` `OWASP Juice Shop` `Falco` `K8s Audit` `OpenTelemetry` `k3d`

</td>
</tr>
</table>

> 각 저장소의 설치 방법, 환경 변수, 디렉터리 구조와 세부 구현은 해당 저장소의 README에서 관리합니다. 이 Organization README는 전체 프로젝트의 목적과 두 저장소의 관계를 설명하는 통합 소개 페이지입니다.



---

## 🧪 Live Demo

SENTINEL-OPS를 직접 체험해볼 수 있는 두 가지 주소입니다.

| 구분 | 주소 | 설명 |
| --- | --- | --- |
| 🚀 SENTINEL-OPS Dashboard | [dashboard-phi-ten.vercel.app](https://dashboard-phi-ten.vercel.app/) | 실시간 로그·인시던트·상관분석 결과를 확인하는 SIEM 대시보드 |
| 💥 공격 더미 생성기 | [35.216.79.173:8900](http://35.216.79.173:8900) | WAF·WAS·Falco·K8s Audit 계층의 공격 시나리오를 발생시키는 테스트 도구 |

### 테스트 방법
1. [SENTINEL-OPS Dashboard](https://dashboard-phi-ten.vercel.app/)에 접속해 Overview 화면을 열어둡니다.
2. [공격 더미 생성기](http://35.216.79.173:8900)에서 원하는 공격 시나리오(SQL Injection, XSS, 비정상 셸 실행, RBAC 변경 시도 등)를 실행합니다.
3. 몇 초 내로 대시보드의 Overview · Incident · ATT&CK 화면에서 해당 공격이 하나의 인시던트로 상관분석되어 나타나는 것을 확인할 수 있습니다.

> ⚠️ 공격 더미 생성기는 테스트용 Target 서버(OWASP Juice Shop 기반)로만 트래픽을 보내며, 실제 서비스에는 영향을 주지 않습니다.

### 로컬 환경 구축은 권장하지 않습니다

SENTINEL-OPS는 Kubernetes, Kafka, OpenTelemetry, OpenSearch, ClickHouse 등 여러 무거운 인프라 컴포넌트로 구성되어 있어, 로컬(개인 PC)에 직접 클론해서 띄우는 것은 **권장하지 않습니다.** 최소 사양으로 구성해도 상당한 CPU·메모리·디스크 용량을 필요로 하며, 셋업 과정도 복잡합니다.

기능을 확인하거나 테스트해보고 싶다면, 위에 안내된 **배포된 Dashboard와 공격 더미 생성기를 이용하는 것을 추천**합니다. 별도 설치 없이 바로 실제 동작을 확인할 수 있습니다.

---
## 👥 Team Members

<table>
<tr>
<th align="center">Name</th>
<th align="center"><a href="https://github.com/yongwook0001-hub">이용욱</a></th>
<th align="center"><a href="https://github.com/SimDaum">심다움</a></th>
<th align="center"><a href="https://github.com/hajh1113">하지환</a></th>
<th align="center"><a href="https://github.com/yjaeyoung">윤재영</a></th>
<th align="center"><a href="https://github.com/sdy100million">서동영</a></th>
</tr>

<tr>
<th align="center">Profile</th>
<td align="center" valign="middle">
<a href="https://github.com/yongwook0001-hub">
<img src="https://github.com/yongwook0001-hub.png" width="100" height="100" alt="이용욱" />
</a>
</td>
<td align="center" valign="middle">
<a href="https://github.com/SimDaum">
<img src="https://github.com/SimDaum.png" width="100" height="100" alt="심다움" />
</a>
</td>
<td align="center" valign="middle">
<a href="https://github.com/hajh1113">
<img src="https://github.com/hajh1113.png" width="100" height="100" alt="하지환" />
</a>
</td>
<td align="center" valign="middle">
<a href="https://github.com/yjaeyoung">
<img src="https://github.com/yjaeyoung.png" width="100" height="100" alt="윤재영" />
</a>
</td>
<td align="center" valign="middle">
<img src="https://github.com/sdy100million.png" width="100" height="100" alt="서동영" />
</td>
</tr>

<tr>
<th align="center">Role</th>
<td align="center">Team Leader<br/>Fullstack, DevOps</td>
<td align="center">Fullstack, DevOps</td>
<td align="center">Fullstack</td>
<td align="center">Backend</td>
<td align="center">Frontend</td>
</tr>
</table>

---

## 📚 Documentation
- [Team Notion](https://app.notion.com/p/Techeer-12th-B-team-38ecc8a8704080ab8bd8d238da3e999c?source=copy_link)
- [Central SIEM README](https://github.com/2026-Techeer-Summer-BootCamp-Team-B/IDS-COLLECTOR#readme)
- [Target Security Node README](https://github.com/2026-Techeer-Summer-BootCamp-Team-B/Techeer-12th-b#readme)
- [Backend Engineering Notes](https://github.com/2026-Techeer-Summer-BootCamp-Team-B/IDS-COLLECTOR/blob/main/docs/BACKEND_ENGINEERING_NOTES.md) 
- [Architecture & Engineering Decisions](https://github.com/2026-Techeer-Summer-BootCamp-Team-B/IDS-COLLECTOR/blob/main/docs/BACKEND_ENGINEERING_NOTES.md)
- [API Documentation](https://github.com/2026-Techeer-Summer-BootCamp-Team-B/IDS-COLLECTOR/blob/main/docs/BACKEND_ENGINEERING_NOTES.md#%ED%94%84%EB%A1%A0%ED%8A%B8%EC%97%94%EB%93%9C-%EC%97%B0%EB%8F%99-api)
- [Deployment Notes](https://github.com/2026-Techeer-Summer-BootCamp-Team-B/IDS-COLLECTOR/blob/main/docs/BACKEND_ENGINEERING_NOTES.md#L300-L319)
- [Detection Scenario Rules](https://github.com/2026-Techeer-Summer-BootCamp-Team-B/IDS-COLLECTOR/blob/main/servers/correlation-engine/app/scenarios/README.md)
- [Scenario Guide](https://github.com/2026-Techeer-Summer-BootCamp-Team-B/Techeer-12th-b/blob/main/SECURITY_TOOLS_TESTING.md)

---

<div align="center">

### From fragmented security logs to one connected incident.

**SENTINEL-OPS · 2026 Techeer Summer Bootcamp Team B**

</div>
