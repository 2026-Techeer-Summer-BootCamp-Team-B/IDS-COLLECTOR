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
Traefik(`:80/api/*`)을 거쳐 `servers/platform-api`와 REST/WebSocket으로만 통신한다
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
     -> enrich(GeoIP + was/waf 정적 orchestrator 매핑) -> emit
  -> Kafka 토픽 events.normalized
       ├─ servers/correlation-engine: 시나리오 룰(sequence/threshold) 평가 -> 발화 시
       │    PostgreSQL incidents/incident_events upsert + Redis pub/sub(incidents:events) 발행
       │    └─ servers/platform-api: pub/sub 구독 -> WebSocket(/ws/incidents)로 릴레이
       │         + CRITICAL이면 Slack/Discord 웹훅
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
- WebSocket도 같은 경로로: `ws://<host>/api/ws/incidents` -> platform-api의
  `/ws/incidents`로 프록시됨 (실측 확인 완료).
- `/api` 외 나머지 경로(`/`, 정적 자산 등)는 프론트엔드가 자기 서비스를 만들어서
  Traefik에 라우터/라벨을 추가하면 된다 (otel-collector/platform-api의 Traefik
  labels가 참고 예시).
- CORS는 이미 열려있음(`CORS_ALLOWED_ORIGINS` 환경변수로 제한 가능, 기본값 `*`) -
  같은 origin(Traefik 경유)이면 사실 CORS가 필요 없지만, 프론트 개발 서버를 다른
  포트로 따로 띄워서 개발할 때를 위해 남겨둠.
- 인증은 쿠키가 아니라 `/auth/login` 응답 토큰을 프론트가 직접 들고 다니는 방식.
- **모든 REST 엔드포인트(로그인/헬스체크 제외)는 `Authorization: Bearer <token>` 필수** -
  없거나 만료된 토큰이면 401. 읽기(GET)는 로그인만 되어 있으면 되고(`admin`/`viewer`
  둘 다 허용), 쓰기(POST/PATCH/DELETE)는 `role=admin`만 허용(그 외는 403).
- WebSocket(`/ws/incidents`, `/ws/events`)도 인증이 필요한데, 브라우저 `WebSocket` API가
  커스텀 헤더를 못 보내므로 **쿼리스트링으로 토큰을 전달**:
  `ws://<host>/api/ws/incidents?token=<token>` (토큰 없거나 무효면 핸드셰이크 단계에서
  코드 1008로 닫힘).

| 메서드/경로 | 설명 |
| --- | --- |
| `GET /incidents?status=&limit=` | 인시던트 목록. `status`는 `open`/`investigating`/`closed` |
| `GET /incidents/{id}` | 인시던트 상세 |
| `GET /incidents/{id}/events` | 인시던트에 묶인 이벤트 목록 (`event_id`, `event_module`, `added_at`) |
| `PATCH /incidents/{id}/status` | 상태 변경. `open`→`investigating`→`closed` 선형 전이만 허용 (역행/건너뛰기는 400) |
| `POST /auth/login` | `{username, password}` -> `{token}`. 스펙 미설계 스텁, 단일 관리자 계정 |
| `GET /auth/session` | `Authorization: Bearer <token>` 검증 -> `{valid, username?}`. **role 필드 없음** (RBAC 미반영) |
| `POST /auth/logout` | `Authorization: Bearer <token>` 필요. 토큰 폐기 -> `{status:"ok"}` |
| `GET /stats?start=&end=` | ISO8601 구간 module/severity별 집계 |
| `GET /stats/top-ips?start=&end=&limit=` | 공격 발원지 IP Top-N (`source.ip` terms agg) -> `{items:[{source_ip,count}]}` |
| `GET /reports/trend?days=7` | AI 트렌드 리포트. `ANTHROPIC_API_KEY` 미설정이면 `configured:false`+원본 통계만 반환 |
| `WS /ws/incidents?token=` | 상관분석 엔진이 발화할 때마다 인시던트 객체(JSON)를 그대로 push (연결 유지용 outbound는 없음) |

인증/통계 엔드포인트는 현재 어느 것도 서버 쪽에서 Authorization을 강제하지 않는다
(auth.py의 login/session/logout만 예외 — 토큰 발급/검증 자체가 목적이라 당연히
검사함). 프론트는 로그인 후 모든 REST 호출에 `Authorization: Bearer <token>`을
항상 붙이도록 만들어뒀지만(dashboard/src/lib/authApi.js), 백엔드가 그걸 실제로
검사해서 401/403을 돌려주기 시작하는 건 role(RBAC) 모델이 들어온 다음 얘기.

인시던트 JSON 형태(REST/WS 공통):
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
  "updated_at": "ISO8601"
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
| `detection_rules` | 단일 이벤트 탐지 룰 (시그니처) — 스키마만 준비, 평가 서비스 없음 |
| `scenario_rules` | 상관분석 시나리오 룰 — correlation-engine의 `app/scenarios/*.yaml`이 sync (YAML이 source of truth) |
| `incidents` | 상관분석으로 묶인 보안 사고 (`correlation_key_type`/`value`, `severity`, `status`, `mitre_tactics`) |
| `incident_events` | 인시던트 <-> 이벤트 매핑 (event_id는 OpenSearch/ClickHouse event.id를 문자열로만 참조, 교차 저장소라 FK 불가) |
| `audit_logs` | 관리자 행위 감사 로그 |

`incidents.status`는 `open` → `investigating` → `closed` 선형 전이만 허용
(`idx_incidents_open_dedup` unique index로 발화 멱등성 보장).

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
| `incidents:events` (pub/sub 채널) | 발화 -> platform-api WebSocket 릴레이 | 해당없음 |

(IP 차단/세션 스토어용 `blacklist:{ip}`/`session:{token}`/원본 이벤트 버퍼용
`stream:events`는 Target 쪽 WAF 센서가 쓰던 것으로 이 레포 범위 밖 — 검토 필요 상태로 보류)

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
    postgres/    - users/targets/allow_list/detection_rules/scenario_rules/incidents/incident_events/audit_logs
    redis/       - dedupe(P3) + 상관분석 윈도우/쿨다운(P4) + pub/sub 공용
    opensearch/  - OpenSearch + Data Prepper (raw 사본 + 정규화 사본 2개 파이프라인)
    clickhouse/  - ClickHouse (events.normalized 직결, JSONExtract 구조화 컬럼)
  shared/              - normalizer/correlation-engine이 공유하는 pip 패키지(ids_shared) -
                          NormalizedEvent 스키마 정의가 유일한 원본이라 두 서비스 다 이걸
                          설치해서 쓴다(수동 복제 금지, 아래 참고)
  normalizer/         - Kafka 컨슈머 + dedupe + 파서 4종 + 정규화 + enrichment + emit
  correlation-engine/  - 시나리오 룰 엔진(sequence/threshold) + 인시던트 생명주기
  platform-api/        - 인시던트 API + 인증(실사용자 검증, 세션은 메모리 스토어) + 알림 + AI 리포트 스텁 + WebSocket 릴레이
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

Python 서비스(normalizer/correlation-engine/platform-api)는 전부 `python:3.11-slim`.

## 트러블슈팅 노트

- Traefik `web` 엔트리포인트(:80)의 `/api` 라우터는 `stripprefix` 미들웨어로
  `/api` 프리픽스를 뗀 다음 platform-api(8400)로 넘긴다 - REST/WebSocket 둘 다
  실측 확인 완료(`curl http://localhost/api/incidents`, `ws://localhost/api/ws/incidents`).
  프론트엔드 서비스를 추가할 땐 `traefik.enable=true` + 다른 PathPrefix(또는 기본
  라우터)로 라벨만 달면 같은 네트워크(`siem-net`)에서 자동으로 잡힌다.
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
- enrichment: GeoIP(더미) + was/waf 정적 orchestrator 매핑(단일 타깃 전제)
- 실패 시 parse 실패 -> `events.dlq`, emit 실패 -> offset 미커밋 재처리
- `events.normalized`로 emit, OpenSearch는 더 이상 직접 안 만짐 (Data Prepper가 대체)

### `servers/correlation-engine`
- `events.normalized` 실시간 소비, `app/scenarios/*.yaml`(카테고리별로 분리 -
  `app/scenarios/README.md` 참고) 선언 룰(sequence/threshold) 평가
- Redis로 시퀀스 대기 상태/threshold 카운터/쿨다운 관리
- 발화 시 `scenario_rules`를 FK로 참조하는 `incidents`/`incident_events` upsert(open 병합)
  + Redis pub/sub(`incidents:events`) 발행. MITRE 전술은 `mitre_mapping.py`(MITRE 공식
  Containers 매트릭스 대조 완료)로 technique_id -> tactics 변환해서 저장
- 18개 시나리오(S1~S18) 전부 falcosecurity/plugins의 실제 K8s audit 룰에 근거한
  설계 - 엔진 검증용 예시가 아님(`app/scenarios/README.md` 참고)

### `servers/platform-api`
- 프론트엔드(별도 팀/레포)의 유일한 연동 지점 - 위 "프론트엔드 연동 API" 참고, CORS 허용
- 인시던트 API, 인증(users 테이블 실사용자 검증), Slack/Discord 알림, AI 트렌드 리포트 스텁, WebSocket 릴레이

## 아직 안 된 것 / 스텁인 것

- WAF의 `rule.name`은 아직 `rule.id`(matched_rule_id)와 같은 값 재사용 중 - 센서가
  별도 규칙 이름 필드를 주면 분리할 것
- was/waf의 정적 orchestrator 매핑(`juice-shop-68ccbc74b4-xh7r8` 등)은 하드코딩 -
  실제 배포 pod 이름이 바뀌면 `app/enrichment.py`만 교체 (나중엔 K8s API 조회로 대체 가능)
- was의 XFF(`http_x_forwarded_for`): Target(Techeer-12th-b)의
  `juice-shop-nginx-configmap.yaml` log_format에 필드를 추가함(2026-07-12) - 이제
  값이 실려오는지는 실측 확인 필요. `request_time`/`body_bytes_sent`는 확인 결과
  이미 log_format에 있었음(README의 예전 서술이 틀렸었음) - was.request_time/
  http.response.body.bytes는 이미 채워지고 있었을 것
- `detection_rules`: 테이블만 있고 이걸 평가하는 서비스가 없음 (단일 이벤트 시그니처 탐지)
- `users`/`targets`/`allow_list`: 테이블만 있고 이걸 다루는 API/화면이 없음
- 인증(P5-2): Target에서 실제 이관될 역할(RBAC) 모델 미반영
- AI 트렌드 리포트: Anthropic API 호출 자체가 TODO
- 프론트엔드 팀에게 인계해야 할 집계 API 갭: 컨슈머 lag, DLQ 깊이, 클록 차
  (event.ingested - @timestamp), 4소스 계층별 통계, ATT&CK 커버리지, ground-truth
  라벨 매칭(precision/recall) - 지금은 `GET /reports/trend`(시나리오별 집계)만 있음
- `mitre_mapping.py`: CONTAINERS_MATRIX(공식 Containers 매트릭스 카탈로그, MITRE
  공식 페이지 대조 확인 완료)는 채워져 있으나, app/scenarios/*.yaml이 실제로 쓰는
  technique_id는 아직 일부(T1609/T1552/T1190/T1136/T1098/T1485/T1133/T1613/T1685/
  T1610/T1611)뿐 (시크릿 enumeration은 검토 결과 falcosecurity/plugins의 실제
  룰에도 "get 성공/실패"뿐 - 별도 정교화 근거 없어서 현행 S2 유지)
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
