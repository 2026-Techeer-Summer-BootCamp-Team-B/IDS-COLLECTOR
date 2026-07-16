# IDS-COLLECTOR

kafka 트러블 슈팅
1. Bitnami 이미지 → Apache 공식 이미지로 교체 (무료 이미지 정책 변경 이슈)
2. 단일 노드 Kafka는 offsets.topic.replication.factor=1로 반드시 낮춰야 함
3. 컨테이너 안에서 exec할 땐 EXTERNAL(9092) 아니라 내부 리스너(9094) 써야 함

backend 역할:
- Kafka consumer
- JSON 로그 파싱
- Falco/K8s/App 로그 분류
- GeoIP 조회
- 정규화
- 상관분석
- DB 저장

커밋될 변경사항
"refactor(backend): Redis 제거하고 Kafka consumer로 전환"

1. backend/app/config.py — redis 설정 필드 전부 제거, kafka_brokers/kafka_topic/kafka_consumer_group 추가
2. backend/app/main.py — Redis Stream consumer 삭제 → aiokafka 기반 Kafka consumer로 교체. app-logs 토픽의 otlp_json 
3. 메시지를 파싱해서 log.source(was/falco/k8s-audit) + body를 뽑아 normalize()로 연결. Redis pub/sub 실시간 알림 코드/TODO도 제거
4. backend/app/normalizer.py — normalize_falco, normalize_k8s_audit 추가. was 하나만 되던 걸 mysite가 실제로 보내는 3개 로그 소스 전부 커버하도록 확장
5. backend/requirements.txt — redis 제거, aiokafka==0.12.0 추가
6. docker-compose.yml — 안 쓰던 redis-data 볼륨 선언 제거

대시보드 트러블
1. weightedPick()을 .find() 콜백 안에서 호출해서, 비교할 때마다 새로 랜덤 국가를 뽑는 꼴이 되어 거의 매칭이 안 됨. 
2. 그 결과 country가 다음 줄 country.name에서 죽음. 
3. App.jsx가 모든 탭(Overview/Incidents/ATT&CK/Infrastructure)을 한꺼번에 import하기 때문에, 흰화면
4.  npm run build가 성공했던 건 이게 import 경로 문제가 아니라 런타임 로직 버그였기 때문입니다.

수정
1. 랜덤 코드를 먼저 변수로 뽑고 그걸로 찾도록 분리 (attackevents.js)
2. 겸사겸사 InfrastructureView.jsx의 ./attackEvents import를 실제 파일명 attackevents.js에 맞게 고침 — macOS는 대소문자 구분 안 해서 지금은 안 터지지만 나중에 Docker(Linux)에서 빌드하면 같은 문제가 재발했을 부분
Central SIEM 데이터 파이프라인. mysite(Target 서버)에서 발생한 로그를 OTLP로 수신해
소스별 Kafka 토픽에 적재하고, 정규화 -> 상관분석 -> 저장 -> API로 이어지는 백엔드
파이프라인. 대시보드 프론트엔드는 다른 팀이 **이 레포(IDS-COLLECTOR) 안에** 직접
파일을 추가해서 작업하지만, 백엔드와는 코드/네트워크 레벨로 얽히지 않고
Traefik(`:80/api/*`)을 거쳐 `servers/platform-api`와 REST로만 통신한다(계약 v1.1 §7 -
WebSocket/Redis pub/sub 경로 없음, 대시보드는 주기 폴링 단일 모델)
(아래 "프론트엔드 연동 API" 참고). 이 문서/커밋에는 프론트엔드 코드가 없다 -
그쪽 팀이 알아서 추가함.

정규화 계약(§1~§6, event.id 해시 공식/ECS 점 표기/심각도 매핑/소스별 wire 필드)은
정규화 계약 문서가 기준이다 - 코드와 어긋나면 문서를 따라 코드를 고칠 것.

## Flow

```
Target 서버
  -> OTLP(gRPC/HTTP) -> Traefik(gRPC h2c 라우팅) -> otel-collector
  -> resource attribute log.source 기준 라우팅 -> Kafka 소스별 토픽
     events.was / events.waf / events.falco / events.audit  (매칭 안 되면 events.unknown)
     (partitions=1, replication=1, retention 24h, cleanup.policy=delete)
  -> servers/normalizer: dedupe(Redis) -> parse(소스별 4종) -> normalize(ECS 점 표기)
     -> enrich(GeoIP(geoip2fast, 국가만) + was/waf 동적 orchestrator 매핑, 값이 없을 때만 정적 폴백) -> emit
  -> Kafka 토픽 events.normalized
       ├─ servers/correlation-engine: 시나리오 룰(sequence/threshold) 평가 -> 발화 시
       │    PostgreSQL incidents/incident_events upsert (그게 끝, push 없음)
       │    └─ servers/platform-api: 프론트는 GET /incidents?since=를 3~5초 폴링해서
       │         실시간 팝업 구현 + incident_alerts.py가 incidents.notified_at을
       │         폴링해서 Slack/Discord 웹훅 발송 (2026-07-13 이전엔 Redis pub/sub
       │         push + WebSocket 릴레이였으나, platform-api 재시작 중 유실 문제로 대체)
       ├─ Data Prepper: OpenSearch attack-logs-* 일 단위 인덱스에 색인 (_id=event.id)
       └─ ClickHouse Kafka 엔진 -> security_events_analytics (JSONExtract로 타입 컬럼화)

동시에 원본(raw) 사본도 별도 컨슈머로 흘러간다:
  events.was/waf/falco/audit -> Data Prepper -> OpenSearch otel-logs-raw-* (포렌식용)

프론트엔드(다른 팀, 이 레포 안에 자체 추가) -> Traefik(:80) -> /api/* -> platform-api
                                            -> / (그 외 경로)  -> 프론트엔드 정적 서비스
```

## 정규화 계약 요약 (NormalizedEvent)

- 필드명은 전부 **ECS 점 표기** (`event.module`, `source.ip` 등). 언더스코어 표기 없음.
  Pydantic 내부 필드명은 언더스코어(코드 가독성용)지만 `by_alias` 직렬화 결과 JSON
  키는 점 표기 그대로 flat하게 나간다 (중첩 객체 아님 - 아래 "트러블슈팅" 참고).
- 해당 없는 필드는 null이 아니라 **생략** (`model_dump_json(..., exclude_none=True)`).
- `event.id`(dedupe 키 겸 OpenSearch `_id`):
  - was/waf/falco: `sha256_hex(observedTimeUnixNano + "|" + body)`
  - k8s_audit: `auditID` 그대로
- `event.module` 값: `was` / `waf` / `falco` / **`k8s_audit`**(토픽·내부 dispatch는
  `audit`이지만 저장값은 `k8s_audit` - wire 표기와 저장 표기가 다름, 헷갈리지 말 것).
- k8s_audit는 **`stage == "ResponseComplete"`인 레코드만** 정규화한다 - RequestReceived
  등 중간 스테이지는 dedupe/파싱 전에 조용히 드롭 (`app/main.py`의 `_process_body`).
- WAF는 WafAlert 센서 스펙(`attack_type`/`risk_level`/`matched_rule_id`/
  `payload_snippet`/`target_endpoint`/`http_method`/`user_agent`/`blocked`/`mode`/
  `client_ip`) wire 필드를 그대로 받는다 - 센서가 바뀌면 `app/normalizer.py`의
  `normalize_waf`와 계약 문서를 같이 갱신할 것.
- 심각도(`event.severity`)는 `severity.yaml` 참고 - WAF는 `LOW/MEDIUM/CRITICAL`
  대문자, audit는 verb+resource(+subresource) 순차 매치(첫 매치 우선, secrets
  create/update/patch 포함).

## 프론트엔드 연동 API

프론트엔드는 이 레포 안에 자체 폴더(예: `frontend/` 등, 프론트 팀이 알아서 정함)로
파일을 추가하지만, 백엔드 서비스와는 **Traefik을 거친 API 호출로만** 통신한다 -
서버 코드를 직접 import하거나 같은 프로세스에서 돌지 않는다.

- 진입점은 Traefik 하나 (`http://<host>/`, 로컬은 `http://localhost/`).
- `/api/*` -> `servers/platform-api`(8400)로 라우팅 (Traefik이 `/api` 프리픽스를
  벗기고 전달 - `servers/docker-compose.yml`의 `platform-api` 서비스 labels 참고).
  예: 프론트에서 `fetch("/api/incidents")` -> platform-api의 `GET /incidents`.
- 개별 이벤트 티커도 같은 경로로: `GET /api/events/recent?since=&limit=` -> platform-api의
  `GET /events/recent`로 프록시됨. 인시던트 실시간 팝업(`GET /api/incidents?since=`)과
  같은 since 폴링 패턴이다(2026-07-14 이전엔 `/ws/events`로 events.normalized를 직접
  tail했으나 계약 v1.1 §7에 따라 제거 - 인시던트 실시간 팝업도 그 전날 같은 이유로
  `/ws/incidents`에서 폴링으로 먼저 전환됨).
- `/api` 외 나머지 경로(`/`, 정적 자산 등)는 프론트엔드가 자기 서비스를 만들어서
  Traefik에 라우터/라벨을 추가하면 된다 (otel-collector/platform-api의 Traefik
  labels가 참고 예시).
- CORS는 이미 열려있음(`CORS_ALLOWED_ORIGINS` 환경변수로 제한 가능, 기본값 `*`) -
  같은 origin(Traefik 경유)이면 사실 CORS가 필요 없지만, 프론트 개발 서버를 다른
  포트로 따로 띄워서 개발할 때를 위해 남겨둠.
- 인증은 쿠키가 아니라 `/auth/login` 응답 토큰을 프론트가 직접 들고 다니는 방식.
- **인증 강제는 platform-api 앱이 아니라 Traefik이 한다** (`servers/docker-compose.yml`의
  `platform-api-auth` forwardAuth 미들웨어 -> platform-api의 `GET /auth/verify` 호출).
  `/api/auth/*`, `/api/health`를 제외한 모든 `/api/*` 요청이 이 게이트를 거친다 -
  `Authorization: Bearer <token>`이 없거나 무효면 Traefik이 401을 그 자리에서 반환하고
  platform-api까지 요청이 가지도 않는다. 읽기(GET)는 로그인만 되어 있으면 되고
  (`admin`/`viewer` 둘 다 허용), 쓰기(POST/PATCH/DELETE)는 `role=admin`만 허용(그 외는 403).
- 주의: `platform-api:8400` 직결 포트(로컬 디버깅 편의용, `servers/docker-compose.yml`에서
  호스트 `127.0.0.1`에만 바인딩됨)는 Traefik을 거치지 않으므로 이 인증이 전혀 적용되지
  않는다. GCP VM 등 원격 호스트에서 이 포트로 붙어야 하면 SSH 터널을 쓸 것
  (예: `ssh -L 8400:localhost:8400 <host>`) - 포트 자체를 외부에 노출하면 안 된다.

| 메서드/경로 | 설명 |
| --- | --- |
| `GET /incidents?status=&since=&limit=` | 인시던트 목록. `status`는 `open`/`investigating`/`closed`. `since`(ISO8601)를 주면 그 시각 이후 생성된 인시던트만 오래된순 반환 - 프론트 실시간 팝업이 이걸 3~5초 주기 폴링(`since`=마지막 확인 시각) |
| `GET /incidents/{id}` | 인시던트 상세 |
| `GET /incidents/{id}/events` | 인시던트에 묶인 이벤트 목록 (`event_id`, `event_module`, `added_at`) |
| `GET /incidents/{id}/timeline` | 스토리라인(시간순) - `incident_events` + OpenSearch 원문을 합쳐 `{event_id, event_module, added_at, title, detail, mitre_technique_id}` 배열로 반환 |
| `PATCH /incidents/{id}/status` | 상태 변경. `open`→`investigating`→`closed` 선형 전이만 허용 (역행/건너뛰기는 400) |
| `PATCH /incidents/{id}/verdict` | 정답 라벨(`{verdict: "true_positive"\|"false_positive", note?}`) 기록 - `status`(처리 단계)와 별개 축이라 어느 status에서든 설정/재설정 가능. `GET /scenarios`의 `precision` 집계 재료 (2026-07-15) |
| `GET /scenarios` | 상관 시나리오 룰 + 적중 랭킹(`hit_count`, 매칭된 인시던트 수) + 탐지 품질(`true_positive_count`/`false_positive_count`/`precision`, verdict 미기록 시나리오는 `precision: null`) |
| `PATCH /scenarios/{id}/enabled` | 시나리오 룰 on/off (Postgres + Redis `scenario:enabled:{id}` 동시 반영, admin 전용) |
| `GET /banned-ips` | 활성 차단 IP 목록(`unbanned_at IS NULL`) - 감사 트레일용, 실제 트래픽은 막지 않음 |
| `POST /banned-ips` | `{ip_or_cidr, reason?}` 차단 기록 (admin 전용, `IP_BANNED` 감사 로그) |
| `DELETE /banned-ips/{id}` | 차단 해제 (admin 전용, `IP_UNBANNED` 감사 로그) |
| `POST /auth/login` | `{username, password}` -> `{token}`. `users` 테이블(role: `admin`/`viewer`) 조회, pgcrypto `crypt()` 검증 - 더 이상 단일 하드코딩 계정 아님(`users_api.py`로 계정 CRUD) |
| `GET /auth/session` | `Authorization: Bearer <token>` 검증 -> `{valid, username?, role?}` (`admin`\|`viewer`, 2026-07-14부터 포함) |
| `POST /auth/logout` | `Authorization: Bearer <token>` 필요. 토큰 폐기 -> `{status:"ok"}` |
| `GET /stats?start=&end=` | ISO8601 구간 module(4계층: was/waf/falco/k8s_audit)/severity별 집계 -> `{total, by_module:[{module,count}], by_severity:[{severity,count}]}` |
| `GET /stats/top-ips?start=&end=&limit=` | 공격 발원지 IP Top-N (ClickHouse `security_events_analytics` 집계, 2026-07-14부터 - 이전엔 OpenSearch terms agg였는데 같은 경로로 중복 정의돼 있던 걸 정리) -> `{items:[{source_ip,count}]}` |
| `GET /stats/kpi?hours=24` | Overview KPI 카드용 - 현재/직전 동일 길이 구간의 total/errors(severity>=3)/warnings(severity==2)/sources(고유 event.module 수) + `delta_pct`, `sources_delta` |
| `GET /stats/volume?hours=24&buckets=25&module=` | Log Volume 차트용 - `@timestamp` date_histogram, 버킷별 `{ts, total, errors}` (errors = severity>=3). `module`은 선택 - 주면 WAS/Falco/K8s Audit 상세 뷰처럼 해당 event.module로만 필터링 |
| `GET /stats/levels?hours=24&module=` | Log Levels 차트용 - `event.severity`(1~4) terms agg -> `{total, levels:[{severity,count}]}`. `module`은 volume과 동일하게 선택적 필터 |
| `GET /stats/timeseries?range=24h` | ClickHouse 기반 시계열(range 프리셋: 15m/1h/6h/24h/7d/30d) - 버킷별 `{bucket, total, by_severity:{1,2,3,4}}`, 빈 구간도 0으로 채워서 고정 간격으로 반환 |
| `GET /stats/geo?start=&end=&limit=` | 국가별 탐지 건수(GeoIP, `geoip2fast` 오프라인 DB로 실제 국가 조회 - 도시 단위 매핑은 지원 안 해서 city_name은 항상 null) -> `[{country_iso_code,count}]` |
| `GET /stats/k8s-targets?start=&end=&limit=` | namespace/리소스별 탐지 건수(Infrastructure 표용) -> `[{namespace,resource_name,count}]` |
| `GET /stats/consumer-lag` | Kafka 컨슈머 그룹별(normalizer-workers/correlation-engine/platform-api-event-stream) lag - 파이프라인 자체 헬스 |
| `GET /stats/dlq-depth` | `events.dlq` 토픽 절대 적재량(컨슈머가 없어 lag 개념이 없음 - 깊이만) |
| `GET /stats/clock-skew` | `event.ingested - @timestamp` 표본(OpenSearch attack-logs-* 기준) - 수집 지연 측정용 |
| `GET /attck/coverage` | MITRE ATT&CK Containers 매트릭스 커버리지 - `ids_shared.mitre_mapping.CONTAINERS_MATRIX`(공식 카탈로그 전체) 기준으로 전술→기법 트리를 만들고 실제 발화한 인시던트로 기법별 hit count를 채움. 카탈로그에 있지만 hit=0인 기법도 그대로 포함 |
| `GET /attck/coverage/{technique_id}/incidents` | 그 기법과 연결된 시나리오로 실제 발화한 인시던트 목록 - 커버리지 화면에서 기법 클릭 시 드릴다운 |
| `GET /logs?module=&min_severity=&q=&start=&end=&limit=` | 정규화 이벤트 원본 조회 (Recent Logs 테이블/검색바) - `q`는 OpenSearch `query_string` 그대로 전달 |
| `GET /events/recent?since=&limit=` | 개별 이벤트 실시간 티커(LiveTicker/CriticalAlertPopup)용. `since`(ISO8601)를 주면 그 시각 이후 이벤트만 오래된순, 안 주면 최신순 상위 `limit`건(기본 50, 최대 200) - 프론트가 2초 주기 폴링(구 `/ws/events`, 2026-07-14 계약 v1.1 §7에 따라 제거) |
| `GET /reports/trend?days=7` | AI 트렌드 리포트 (Gemini API). `GEMINI_API_KEY` 미설정이면 `configured:false`+원본 통계만 반환 |

~~인증/통계 엔드포인트는 현재 어느 것도 서버 쪽에서 Authorization을 강제하지
않는다~~ **(2026-07-14 해결)**: 위 "인증 강제는 platform-api 앱이 아니라 Traefik이
한다" 문단 그대로 — `/api/auth/*`, `/api/health`를 제외한 모든 `/api/*`가 Traefik
forwardAuth(`auth.py`의 `GET /verify`)를 거친다. 읽기는 로그인만 되어 있으면
(`admin`/`viewer` 둘 다) 통과, 쓰기(POST/PATCH/DELETE)는 `role=admin`만 통과 —
이 문단은 그 기능이 들어오기 전에 쓰여서 실제 상태와 어긋나 있었다.

인시던트 JSON 형태(GET /incidents, GET /incidents/{id} 공통):
```json
{
  "id": "uuid",
  "title": "string",
  "correlation_key_type": "source.ip | user.name | orchestrator.resource.name",
  "correlation_key_value": "string",
  "severity": 1,
  "status": "open | investigating | closed",
  "matched_scenario_rule_id": "uuid | null",
  "mitre_tactics": ["string"],
  "created_at": "ISO8601",
  "updated_at": "ISO8601",
  "verdict": "true_positive | false_positive | null",
  "verdict_note": "string | null",
  "verdict_at": "ISO8601 | null"
}
```

## 다중 저장소(Polyglot) 역할 분담

- **PostgreSQL**: 메타데이터/보안 룰/인시던트 상태를 관리하는 관계형 뼈대 (무결성 보장,
  FK/CHECK 제약).
- **OpenSearch**: 정규화 이벤트 검색·집계, 실시간 위협 헌팅용 역인덱스 (`_id=event.id`
  디듑키, 일 단위 인덱스).
- **ClickHouse**: 대량 로그 장기 보관 + "최근 1시간 최다 공격 IP Top 10" 같은 집계를
  빠르게 뽑아내는 컬럼형 분석 엔진 (Append-Only, `events.normalized` 직결).
- **Redis**: dedupe 상태(P3) + 상관분석 윈도우/쿨다운(P4) + pub/sub만 — 버퍼 역할은
  Kafka로 이관되어 제거됨.

### PostgreSQL (`servers/datastore/postgres/init/001-schema.sql`)

| 테이블 | 역할 |
| --- | --- |
| `users` | 관리자 계정 (`admin`/`viewer`) |
| `targets` | 보호 대상 애플리케이션 |
| `allow_list` | 예외 IP/대역 (target 스코프 가능) |
| `scenario_rules` | 상관분석 시나리오 룰 — correlation-engine의 `app/scenarios/*.yaml`이 sync (YAML이 source of truth) |
| `incidents` | 상관분석으로 묶인 보안 사고 (`correlation_key_type`/`value`, `severity`, `status`, `mitre_tactics`) |
| `incident_events` | 인시던트 <-> 이벤트 매핑 (event_id는 OpenSearch/ClickHouse event.id를 문자열로만 참조, 교차 저장소라 FK 불가) |
| `audit_logs` | 관리자 행위 감사 로그 |

`incidents.status`는 `open` → `investigating` → `closed` 선형 전이만 허용
(`idx_incidents_active_dedup` unique index로 발화 멱등성 보장 - `open`/`investigating`
둘 다 병합 대상이고, `closed`로 넘어간 뒤 같은 공격이 재발하면 새 인시던트가 생긴다).
`incidents.verdict`(`true_positive`/`false_positive`, null 허용)는 이 상태 전이와
완전히 별개 축이다 - "지금 처리가 어느 단계인지"가 아니라 "이 탐지가 실제로 맞았는지"
정답 라벨이라 `status`가 무엇이든 언제든 설정/재설정할 수 있다.

### OpenSearch (`servers/datastore/opensearch/config/data-prepper/attack-logs-template.json`)

`NormalizedEvent`(ECS 서브셋) 필드 그대로 색인 - 전부 점 표기라 OpenSearch가 자동으로
중첩 객체(`event.*`, `source.geo.*`, `rule.*`, `orchestrator.*`, `kubernetes.audit.*`
등)로 풀어서 매핑한다. 공통 코어(`event.id/module/dataset/kind/action/outcome/
severity/duration/original`) + 상관 키(`source.ip`, `user.name`,
`orchestrator.resource.name`) + 소스별 확장(HTTP/WAF/Falco의 `process.*`+
`container.*`/K8s audit의 `kubernetes.audit.*`) + GeoIP enrichment.

### ClickHouse (`servers/datastore/clickhouse/init/001-kafka-engine.sql`)

`security_events_analytics` — `events.normalized` JSON을 JSONExtract로 타입 있는
컬럼(`LowCardinality`, `IPv6`, `FixedString(2)` 등)으로 뽑아낸 MergeTree 테이블.
IPv4 소스 IP도 `toIPv6OrDefault`로 IPv4-mapped IPv6(`::ffff:x.x.x.x`)로 통일해서
단일 컬럼으로 집계 가능. `rule_name` 컬럼은 `rule.name`(Falco) 우선, 없으면
`rule.id`(WAF)로 폴백해서 소스 무관하게 Top-N 랭킹에 쓸 수 있게 합쳤다.

### Redis 키 네임스페이스

| 키 패턴 | 용도 | TTL |
| --- | --- | --- |
| `dedupe:{key}` | normalizer dedupe (P3-2) | 1h |
| `corr:{scenario}:stage1:{join_key}` | 시퀀스 stage1 대기 상태 | `window_seconds` |
| `corr:{scenario}:count:{join_key}` | threshold 카운터 | `window_seconds` |
| `corr:{scenario}:cooldown:{join_key}` | threshold 쿨다운 | `cooldown_seconds` |
| `scenario:enabled:{id}` | 시나리오 활성/비활성 플래그 (Postgres 값 기준 재시드) | 없음(영구) |
| `session:{token}` | 로그인 세션(app/auth.py) | `session_ttl_seconds` |

(IP 차단 용도의 Redis 키는 없음 - `banned_ips`는 Postgres 기록/감사 전용, 실제
방화벽 집행 없음. 인시던트 알림도 더 이상 Redis pub/sub을 쓰지 않고 Postgres
`incidents.notified_at` 폴링으로 대체됨 - app/incident_alerts.py 참고)

## 디렉토리 구조

백엔드가 쓰는 건 전부 `servers/` 밑에 있다 - 저장소 루트는 프론트엔드(다른 팀이
자체 폴더로 추가 예정, 이 커밋 시점엔 없음)와 나란히 두기 위해 비워둔다.

```
servers/
  otel/        - 중앙 OTLP Collector. routing connector로 log.source별 Kafka 토픽 분리
  kafka/       - Kafka(KRaft 단일 노드) docker-compose + 토픽 부트스트랩
  proxy/       - Traefik (gRPC h2c 라우팅 + /api 단일 진입점 + 자체 관리 대시보드).
                 프론트엔드 서비스가 추가되면 이 밑에 자기 라우터/라벨을 붙이면 됨.
  datastore/
    postgres/    - users/targets/allow_list/scenario_rules/incidents/incident_events/audit_logs
    redis/       - dedupe(P3) + 상관분석 윈도우/쿨다운(P4) + pub/sub 공용
    opensearch/  - OpenSearch + Data Prepper (raw 사본 + 정규화 사본 2개 파이프라인)
    clickhouse/  - ClickHouse (events.normalized 직결, JSONExtract 구조화 컬럼)
  shared/              - normalizer/correlation-engine이 공유하는 pip 패키지(ids_shared) -
                          NormalizedEvent 스키마 정의가 유일한 원본이라 두 서비스 다 이걸
                          설치해서 쓴다(수동 복제 금지, 아래 참고)
  normalizer/         - Kafka 컨슈머 + dedupe + 파서 4종 + 정규화 + enrichment + emit
  correlation-engine/  - 시나리오 룰 엔진(sequence/threshold) + 인시던트 생명주기
  platform-api/        - 인시던트 API(실시간 팝업은 ?since= 폴링) + 인증(실사용자 검증,
                          세션은 Redis) + 알림(Postgres notified_at 폴링) + AI 리포트 스텁
                          (프론트엔드가 Traefik 경유로 붙는 유일한 연동 지점)
  docker-compose.yml   - normalizer/correlation-engine/platform-api 3개 서비스 정의.
                          normalizer/correlation-engine은 shared/를 이미지에 넣어야 해서
                          빌드 컨텍스트가 servers/ 루트다(각자 폴더가 아님) - build.context: .,
                          build.dockerfile: <service>/Dockerfile
```

## Running locally

모든 서비스는 `siem-net`이라는 외부 Docker 네트워크를 공유한다. 저장소 루트에서:

```
make up    # siem-net 생성 후 servers/{kafka,datastore/*,otel,proxy} -> servers 순서로 기동
make down  # 역순으로 정리
```

`make`가 없는 환경(Windows git-bash 등)에서는 Makefile의 `up`/`down` 타겟에 있는
`docker compose -f <파일> up -d` 명령들을 그 순서 그대로 실행하면 된다.

Local-dev 기본값만 있음(TLS/SASL 없음, OpenSearch 보안 플러그인 비활성화, Postgres
크리덴셜은 `servers/datastore/postgres/.env.example`을 `.env`로 복사해서 사용) -
프로덕션 하드닝 안 됨.

포트: otel-collector http `4318`, Traefik(gRPC) `4317`/(http, `/api/*`→platform-api) `80`
/(자체 대시보드) `8080`, Kafka(외부) `9094`, Postgres `5432`, Redis `6379`,
OpenSearch `9200`, ClickHouse `8123`/`9000`, normalizer `8200`, correlation-engine
`8300`, platform-api `8400`(직결 - 디버깅용, 정식 경로는 Traefik `:80/api`).
normalizer/correlation-engine/platform-api 3개 직결 포트(8200/8300/8400)는
`servers/docker-compose.yml`에서 호스트 `127.0.0.1`에만 바인딩되어 있다(Traefik
단일 진입점 원칙 - CLAUDE.md 불변 원칙 5) - 원격 호스트(GCP VM 등)에서 직결 디버깅이
필요하면 SSH 터널을 쓸 것(예: `ssh -L 8400:localhost:8400 <host>`).

Python 서비스(normalizer/correlation-engine/platform-api)는 전부 `python:3.11-slim`.

## 트러블슈팅 노트

- Traefik `web` 엔트리포인트(:80)의 `/api` 라우터는 `stripprefix` 미들웨어로
  `/api` 프리픽스를 뗀 다음 platform-api(8400)로 넘긴다 - 실측 확인 완료
  (`curl http://localhost/api/incidents`). 프론트엔드 서비스를 추가할 땐
  `traefik.enable=true` + 다른 PathPrefix(또는 기본 라우터)로 라벨만 달면 같은
  네트워크(`siem-net`)에서 자동으로 잡힌다.
- Kafka: Bitnami 이미지 → Apache 공식 이미지로 교체 (무료 이미지 정책 변경 이슈).
  단일 노드라 `*_REPLICATION_FACTOR=1` 필수.
- Kafka 리스너: 컨테이너 안(otel-collector, normalizer 등 siem-net 내부)에서는
  내부 리스너 `kafka:9092`, 컨테이너 밖(로컬)에서는 `localhost:9094`.
- gRPC(4317)는 Traefik의 `otlp-grpc` 엔트리포인트로만 들어온다. Traefik v3 +
  `loadbalancer.server.scheme=h2c` 조합으로 h2c preface를 HTTP/1.1로 오인해서
  404를 뱉던 문제를 해결함. HTTP(4318)는 h2c 이슈가 없어서 otel-collector가
  직접 포트를 노출한다. proxy의 docker.sock 마운트는 `/var/run/docker.sock` 고정
  경로를 쓴다 (Mac 전용 `${HOME}/.docker/run/docker.sock` 경로는 Docker Desktop
  on Windows에서 비어있어서 Traefik이 데몬에 아예 못 붙는 문제가 있었음).
- otel-collector의 `routing` 커넥터가 resource attribute `log.source`(was/waf/falco/
  k8s-audit) 값 기준으로 이벤트를 4개 파이프라인으로 나눠서 각각 다른 Kafka 토픽으로
  내보낸다. 매칭 안 되는 소스는 `events.unknown`으로 - 조용히 버려지지 않게.
- `scenario_rules.id`는 UUID인데 `app/scenarios/*.yaml`은 사람이 읽는 코드(S1/S2/...)를
  쓴다 - correlation-engine이 `uuid5(NAMESPACE_OID, "scenario:{code}")`로 결정적 변환해서
  sync하므로, 같은 코드는 재시작해도 항상 같은 UUID로 매핑된다(중복 insert 없음).
- **Kafka 토픽을 삭제·재생성하면 otel-collector의 franz-go 클라이언트가 옛 토픽
  ID/파티션 수를 캐싱하고 있어서 `UNKNOWN_TOPIC_ID` 에러가 한동안 반복된다** -
  자동 재시도로 결국 복구되긴 하지만, 바로 반영하려면 otel-collector 컨테이너를
  재시작할 것.
- **Data Prepper의 `document_id`/`index` 표현식에서 점(`.`) 포함 키를 따옴표로
  다시 감싸면(`${"event.id"}`) 리터럴 키 참조가 아니라 문자열 상수로 취급돼서
  모든 문서의 `_id`가 정말로 `"event.id"`라는 글자 그대로 박혀버린다(실측 확인)**
  - 그냥 `${event.id}`로 참조해야 플랫 키가 제대로 치환된다. 반대로 ClickHouse의
    `JSONExtractString(raw, 'event.id')`는 점을 경로 구분자로 안 쓰고 리터럴
    키로 찾으므로 이런 이슈가 없다 - 둘의 표현식 문법이 다르니 헷갈리지 말 것.
- **ClickHouse Kafka 엔진 테이블을 같은 이름으로 여러 번 DROP/CREATE 하면 이전
  incarnation의 백그라운드 폴링 스레드가 파티션 할당을 붙들고 안 놔줘서(`Can't
  get assignment. Will keep trying.`) 새 테이블이 메시지를 못 받는 경우가
  있었다** - 이럴 땐 SQL로 DROP/CREATE만 하지 말고 ClickHouse 컨테이너 자체를
  재시작할 것 (테이블 정의는 DDL이라 재시작해도 유지됨).

## 서비스별 역할

### `servers/normalizer`
- Kafka consumer (`events.was/waf/falco/audit`, consumer group `normalizer-workers`)
- dedupe: Redis SETNX TTL 1h (audit=auditID, 나머지=`sha256(observedTimeUnixNano+"|"+body)`)
- 소스별 파서 4종 (was/waf/falco/audit) - WAF는 WafAlert 센서 스펙 wire 필드 기준
- ECS 점 표기 정규화 (`NormalizedEvent`, severity.yaml 기반 심각도)
- k8s_audit는 `stage=="ResponseComplete"`만 채택 (나머지 스테이지는 드롭)
- enrichment: GeoIP(`geoip2fast` 오프라인 국가 조회, 도시 매핑은 없음) + was/waf orchestrator 매핑(정상 경로는 nginx-was-logger Downward API/WAF 응답 헤더로 동적 채움, 값이 비어있을 때만 정적 폴백)
- 실패 시 parse 실패 -> `events.dlq`, emit 실패 -> offset 미커밋 재처리
- `events.normalized`로 emit, OpenSearch는 더 이상 직접 안 만짐 (Data Prepper가 대체)

### `servers/correlation-engine`
- `events.normalized` 실시간 소비, `app/scenarios/*.yaml`(카테고리별로 분리 -
  `app/scenarios/README.md` 참고) 선언 룰(sequence/threshold) 평가
- Redis로 시퀀스 대기 상태/threshold 카운터/쿨다운 관리
- 발화 시 `scenario_rules`를 FK로 참조하는 `incidents`/`incident_events` upsert(open 병합)
  로 끝 - platform-api로의 push는 없음(2026-07-13 이전엔 Redis pub/sub(`incidents:events`)
  발행도 했으나 제거됨, 아래 platform-api 절 참고). MITRE 전술은 `mitre_mapping.py`
  (MITRE 공식 Containers 매트릭스 대조 완료)로 technique_id -> tactics 변환해서 저장
- ~~23개 시나리오(S1~S23)~~ **(2026-07-15, S26~S30 추가로 30개)** - S10/S19/S20/S21/
  S22/S23을 제외한 나머지는 falcosecurity/plugins의 실제 K8s audit 룰에 근거한
  설계, 엔진 검증용 예시가 아님(`app/scenarios/README.md` 참고). 그 6개는
  falcosecurity/plugins(k8s_audit 전용 저장소)에 대응 룰이 없어 다른 근거로 이
  프로젝트가 설계함 - S19(로그인 브루트포스, T1110, WAS 원본 access log 기반),
  S20/S21(DaemonSet/CronJob 생성, T1543/T1053, MITRE 공식 기법 설명 직접 근거),
  S22(컨테이너 내 크립토마이닝, T1496, falcosecurity/**rules**(plugins가 아님)
  저장소의 falco-sandbox_rules.yaml 룰 3개를 Target 저장소
  `backend/falco-values.yaml`의 customRules로 이식), S23(시스템 로그 삭제 시도,
  T1070, falcosecurity/rules **코어** falco_rules.yaml에 이미 기본 활성화돼 있던
  "Clear Log Activities" 룰을 그대로 사용 - 별도 이식 불필요, 전부 2026-07-14).
  같은 조사에서 T1036은 코어/sandbox 룰셋 어디에도 대응 룰이 없음을 확인(WebFetch로
  원본 재확인) - falcosecurity 근거가 없어 여전히 미구현.
- **S26~S30(2026-07-15 신규, 전부 `network.yaml`)**: 20/25개가 k8s_audit 위주였던
  불균형을 메우려고 WAF/WAS 신호만으로 발화하는 시나리오 5개를 추가 - 전부
  threshold=1(또는 S30만 threshold=10)로 Target 저장소(Techeer-12th-b)의 WAF
  backend가 **이미 자체 판정을 끝내고 emit하는** 이벤트를 그대로 받는 방식이라
  correlation-engine의 매처(`rules.py::_MATCHERS`) 확장 없이 기존 `event_action`/
  `http_response_status_code` 매처만으로 구현됨: S26(WAF 로그인 브루트포스,
  `attack_type=brute_force` - IP/계정/시스템전체 3종 통합, T1110, S19와 상호보완
  - S19는 WAF 미경유 직결 트래픽만 보고 IP당 단순 카운팅만 하지만 이건 WAF 경유
  트래픽 + 계정 기준(IP 로테이션 대응) + 시스템 전체 스파이크까지 잡음),
  S27(WAF Rate Limit 남용, `attack_type=rate_limit_abuse`, T1499 - 위 문단의
  "T1499/T1498은 falcosecurity 근거가 없어 미구현"은 **Falco 기반 접근 얘기고
  이건 완전히 다른 경로**라 그 블로커와 무관하게 바로 구현 가능했음), S28(알려진
  스캐너 툴 User-Agent, `attack_type=bad_bot`, T1046 - 카탈로그에 있었지만 그동안
  어떤 시나리오도 안 쓰던 기법의 첫 사용), S29(JWT 위조 시도 `alg:none`,
  `attack_type=jwt_forgery`, T1550 - S25와 기법 공유하지만 계층이 다른 별개
  사건), S30(동일 IP WAS 404 다발/엔드포인트·리소스ID 무차별 탐색,
  `http_response_status_code=404`, T1046 - WAF 시그니처가 절대 못 잡는 "페이로드
  없는 정상적인 척하는 요청" 사각지대. 실측 확인: 이 프로젝트 Juice Shop 배포는
  `/rest/*`·`/api/*` 밑의 미등록 경로를 진짜 404가 아니라 500(Express catch-all
  버그, 기존에 S4/S5 payload 테스트 중에도 발견된 것과 동일 증상)으로 응답하고
  SPA 폴백 경로는 200을 내려서, 진짜 404는 `/api/Products/{id}` 같은 존재하는
  라우트에 없는 ID를 넣을 때만 남 - 순수 미등록 경로 브루트포스로는 이 시나리오가
  안 걸리니 테스트/튜닝 시 주의). threshold=10은 실측 기준선이 없는 초기
  추정치라 `PATCH /incidents/{id}/verdict`로 라벨을 쌓아 `GET /scenarios`의
  `precision`을 보고 나중에 조정할 것(015 피드백 루프 용도). 5개 전부 실제 k3d
  클러스터(WAF backend + Juice Shop 대상 curl 트래픽) 대상으로 발화까지 실측
  확인 완료. Notion "상관분석 시나리오" 페이지의 TODO 갭 분석에서 나온 항목

### `servers/platform-api`
- 프론트엔드(별도 팀/레포)의 유일한 연동 지점 - 위 "프론트엔드 연동 API" 참고, CORS 허용
- 인시던트 API(실시간 팝업은 `?since=` 폴링), 인증(users 테이블 실사용자 검증), Slack/Discord 알림(Postgres 폴링), AI 트렌드 리포트 스텁, 개별 이벤트 티커(`GET /events/recent?since=` 폴링)

## 아직 안 된 것 / 스텁인 것

- ~~was/waf의 정적 orchestrator 매핑은 하드코딩~~ **(2026-07-14 해결)**: nginx-was-logger
  사이드카가 Downward API(POD_NAME/POD_NAMESPACE)로 자기 pod를 알아내 was 로그와 모든
  응답에 `X-Served-By-Pod`/`X-Served-By-Namespace` 헤더로 실어 보내고, WAF backend는
  Juice Shop을 프록시할 때 그 헤더를 그대로 옮겨 담아 WafAlert에 실음(Target 저장소
  `juice-shop-nginx-configmap.yaml`/`app/proxy/proxy.py` 참고) - `normalize_was`/
  `normalize_waf`가 이 값을 `orchestrator.*`로 파싱하므로 재배포로 pod 해시가 바뀌거나
  레플리카가 여러 개여도 항상 실제로 그 이벤트를 만든 pod를 정확히 가리킨다.
  `enrichment.py`의 정적 값은 이제 이 값이 비어 있는 경우(WAF prevention 모드로 차단돼
  Juice Shop 응답 자체가 없었던 요청)에만 쓰이는 최후 폴백으로 격하됨.
- was의 XFF(`http_x_forwarded_for`): Target(Techeer-12th-b)의
  `juice-shop-nginx-configmap.yaml` log_format에 필드를 추가함(2026-07-12) - 이제
  값이 실려오는지는 실측 확인 필요. `request_time`/`body_bytes_sent`는 확인 결과
  이미 log_format에 있었음(README의 예전 서술이 틀렸었음) - was.request_time/
  http.response.body.bytes는 이미 채워지고 있었을 것
- ~~`users`/`targets`/`allow_list`: 테이블만 있고 이걸 다루는 API/화면이 없음~~
  **(2026-07-14 해결, 이어서 같은 날 target_name 전파까지 완료)**: 셋 다 CRUD API
  완비(`users_api.py`/`targets_api.py`/`allow_list_api.py`). Target 저장소
  (Techeer-12th-b)의 WAF backend/WAS 사이드카가 이제 `TARGET_NAME`(배포 시점
  고정값 - `backend/app/config.py`, `juice-shop-with-nginx-sidecar.yaml`)을 각각
  `WafAlert.target_name`/WAS access log에 실어 보내고, normalizer가
  `NormalizedEvent.target_name`(ECS `target.name`)으로 정규화한다 - was/waf
  이벤트는 이제 "이게 어느 target 소속인지"를 실측으로 안다(falco/k8s_audit은
  앱 단위가 아니라 클러스터 단위 이벤트라 여전히 None). 이 덕분에 `allow_list`가
  전역(target_id=NULL)뿐 아니라 **target_id로 스코프된 항목도 실제로 집행**된다
  (correlation-engine이 target_id를 targets.name으로 JOIN해서
  event.target_name과 비교, `rules.py`의 `ScenarioEngine._is_allow_listed`) -
  같은 IP라도 등록된 target과 다른 target 소속 이벤트면 억제되지 않는 것까지
  실측 확인(진짜/가짜 타깃 대조 테스트). 여러 target을 실제로 "동시에" 보호하려면
  Target 저장소에 WAF backend+WAS 사이드카 세트를 target마다 복제 배포하고
  `TARGET_NAME`/`TARGET_SERVICE_URL`만 바꾸면 된다(Traefik이 라우팅 담당,
  하나의 프로세스가 여러 업스트림을 다루는 방식은 아님) - 실제로 두 번째 target을
  띄워보는 것 자체는 이 세션 환경 밖의 일이라 코드/설정만 준비해뒀다.
- ~~인증(P5-2): Target에서 실제 이관될 역할(RBAC) 모델 미반영~~ **(2026-07-14 해결)**:
  `users` 테이블에 `role`(`admin`/`viewer`) 컬럼, `users_api.py`(CRUD, 마지막 admin
  강등 방지) + `auth.py`(`SessionResponse.role`, Traefik forwardAuth가 쓰기 요청에
  `role=admin` 강제)까지 구현 완료 — 위 "프론트엔드 연동 API" 절 참고. 아직 없는 건
  외부 IdP(SSO/LDAP) 연동이나 admin/viewer보다 세분화된 팀·타깃 단위 권한 정도.
- 집계 API 갭 (2026-07-14 재확인 - 이 문단이 오래돼서 실제 상태와 어긋나 있었음):
  컨슈머 lag/DLQ 깊이/클록 차(`GET /stats/consumer-lag`, `/stats/dlq-depth`,
  `/stats/clock-skew` - `pipeline_health_api.py`),
  4소스 계층별 통계(`GET /stats`, `stats_api.py`), ATT&CK 커버리지(`GET /attck/coverage`,
  `attck_api.py`) 셋 다 이미 구현돼 있다 - `GET /reports/trend`만 있다는 서술은 이
  셋이 만들어지기 전에 쓰인 채 갱신이 안 된 것. ~~아직 없는 건 ground-truth 라벨
  매칭(precision/recall) 하나뿐~~ **(2026-07-15 해결)**: `incidents.status`(처리
  단계)와 별개 축으로 `incidents.verdict`(`true_positive`/`false_positive`,
  `datastore/postgres/init/018-incident-verdict.sql`)를 추가하고
  `PATCH /incidents/{id}/verdict`로 분석가가 판정을 남기게 했다 - status의 선형
  전이와 달리 언제든 재설정 가능. `GET /scenarios`가 이 라벨을 시나리오별로 집계해서
  `true_positive_count`/`false_positive_count`/`precision`을 같이 내려주므로,
  이제 어떤 시나리오의 threshold/window/cooldown이 오탐이 잦은지 데이터로 판단할
  근거가 생겼다(verdict가 하나도 안 쌓인 시나리오는 `precision: null`로 구분).
  별개로 `GET /stats/top-ips`가 한때 `stats_api.py`(OpenSearch)와
  `analytics_api.py`(ClickHouse) 양쪽에 같은 경로로 중복 정의돼 있어서 후자가
  `main.py`의 include_router 순서 때문에 영원히 안 잡히는 죽은 코드였던 것도
  같이 발견/수정함 - IP 집계는 ClickHouse 쪽을 정본으로 남겼다(응답 계약은 불변).
- `mitre_mapping.py`: CONTAINERS_MATRIX(공식 Containers 매트릭스 카탈로그, MITRE
  공식 페이지 대조 확인 완료)는 채워져 있으나, app/scenarios/*.yaml이 실제로 쓰는
  technique_id는 아직 일부(T1609/T1552/T1190/T1136/T1098/T1485/T1133/T1613/T1685/
  T1610/T1611)뿐 (시크릿 enumeration은 검토 결과 falcosecurity/plugins의 실제
  룰에도 "get 성공/실패"뿐 - 별도 정교화 근거 없어서 현행 S2 유지)
- **프로덕션 크로스-서버 OTLP 인그레스 보안(TODO, 미착수)**: 지금 `CENTRAL_SIEM_OTLP_ENDPOINT=traefik:4317`
  (Techeer-12th-b/otel-collector-deployment.yaml)과 `otlp: tls: insecure: true`
  (servers/otel/config/otel-config.yaml)는 전부 "k3d와 docker-compose가 같은
  Docker Desktop 호스트 위에 있다"는 로컬 개발 전제로 짜여 있다 - `host.docker.internal`/
  `host.k3d.internal` 둘 다 같은 vpnkit NAT 홉을 타서 h2c preface 핸드셰이크가
  깨지는 문제가 있어(otel-collector-deployment.yaml 주석 참고) `docker network
  connect siem-net k3d-...`로 같은 브리지에 직접 붙이는 방식을 씀.
  프로덕션에서는 수집 대상(k3d) 서버와 Central SIEM(docker-compose, Traefik) 서버가
  완전히 분리된 네트워크라 위 방식 자체가 적용 불가 - 공인 인터넷/도메인을 거쳐야 함.
  이 경우 필요한 것:
  - **mTLS**: `proxy/traefik/traefik.yml`의 `otlp-grpc` 엔트리포인트에 서버 인증서 +
    클라이언트 인증서 요구(`tls.options`의 clientAuth) 추가. 지금은 PathPrefix(`/`)만
    매치하고 인증이 전혀 없어서 4317이 열리는 순간 누구나 가짜 OTLP 로그를 찔러넣어
    SIEM을 오염시킬 수 있음. k3d 쪽 otel-collector exporter도 `insecure: true`를
    걷어내고 발급받은 클라이언트 인증서로 붙게 변경.
  - **소스 IP 방화벽 제한**: mTLS와 별개로 클라우드 보안그룹/방화벽에서 4317을
    k3d 서버의 고정 아웃바운드 IP로만 허용(defense-in-depth).
  - **대시보드·디버그 포트 비공개**: `proxy/docker-compose.yml`의 Traefik 대시보드(8080,
    인증 없음 - 코드 주석에도 "local dev only"로 명시됨)와 `servers/docker-compose.yml`의
    platform-api 직결 포트(8400)는 공인 서버에 그대로 열면 안 됨 - 프로덕션 compose
    오버라이드에서 포트 노출 제거하거나 별도 인증 필요.
  - 인증서는 아직 미발급 - 도메인/배포 서버 확정되면 자체 CA(openssl)로 서버·클라이언트
    인증서 양쪽 발급 예정.
- request body 파싱(2026-07-12): S12/S13(RBAC 룰/바인딩) → S16(pod 보안 컨텍스트)
  → S17/S18(NodePort Service/ConfigMap 자격증명)까지 확장 완료. `k3d-audit-policy.yaml`이
  roles/clusterroles/rolebindings/clusterrolebindings(RequestResponse) +
  pods/services/configmaps(Request)의 관련 verb에 대해서만 `requestObject`를
  남기고 있어서 이 7개 리소스에 한해서만 request body 기반 필드가 채워진다.
  `NormalizedEvent`에 `kubernetes.audit.role.rule_flags`/
  `kubernetes.audit.binding.role_name`/`kubernetes.audit.pod.security_flags`/
  `kubernetes.audit.service.type`/`kubernetes.audit.configmap.has_credentials`
  필드 추가, `normalize_audit()`/`_matches()` 확장함 - 정규화 계약 문서(Notion
  "정규화") §4-4에 반영 완료. 원본 48개 룰 중 request body가 필요했던 것은 이제
  거의 다 구현됨(남은 건 Ingress without TLS 정도, 낮은 우선순위)
- RBAC verb 범위(severity.yaml): K8s API의 RBAC 오브젝트 변경 verb 전체(create/
  delete/deletecollection/patch/update)로 확정 완료. "replace"는 k8s audit verb에
  실존하지 않고(PUT도 "update"로 남음) 대신 deletecollection(대량 삭제)이 빠져있던
  게 버그였음 - severity.yaml/rbac.yaml(S3) 수정 완료(2026-07-12)
