# SENTINEL-OPS 부하 테스트

k6로 두 경로를 따로 테스트한다. 하나로 합치지 않은 이유는 두 경로가 서로 다른
병목(수집 파이프라인 vs 조회 API)을 보여주기 때문 - 같이 돌리면 어느 쪽 때문에
느려졌는지 구분하기 어렵다.

- `otlp-ingest.js` — OTel Collector의 OTLP HTTP(4318)로 직접 로그를 쏴서 수집
  파이프라인(otel-collector → Kafka → normalizer → OpenSearch/ClickHouse) 처리량을
  본다. Traefik/mTLS를 거치지 않는다(4318은 호스트에 직접 노출돼 있음).
- `platform-api.js` — 로그인 후 대시보드가 실제로 폴링하는 API들(`/stats`,
  `/stats/timeseries`, `/events/recent`, `/incidents`, `/stats/consumer-lag`)에
  동시 요청을 보내서 조회 쪽(ClickHouse/OpenSearch/PostgreSQL) 응답 시간을 본다.

## 준비물

- [k6](https://k6.io/docs/get-started/installation/) 설치 (`brew install k6`)
- GCP 서버가 떠 있어야 함
- platform-api 테스트는 실제 로그인 계정(username/password) 필요

## 실행

```bash
# 1) 수집 파이프라인 부하 테스트
TARGET_HOST=35.216.79.173 VUS=50 DURATION=2m \
  k6 run servers/loadtest/otlp-ingest.js

# 2) 대시보드 API 부하 테스트 (도메인은 프로토콜 없이, HTTPS 고정)
TARGET_HOST=35-216-79-173.sslip.io K6_USERNAME=<계정> K6_PASSWORD=<비밀번호> VUS=30 DURATION=2m \
  k6 run servers/loadtest/platform-api.js
```

`VUS`(동시 가상 사용자 수)와 `DURATION`은 둘 다 기본값(20 VU / 60s)이 있어 생략
가능. 서버 사양(4vCPU/16GB 단일 VM, 이전 트러블슈팅 글 참고)을 감안하면 처음엔
낮은 VU로 시작해서 단계적으로 올리는 걸 권장.

## 테스트 중 같이 봐야 하는 것 (Grafana)

부하 테스트 자체의 응답 시간(k6가 출력하는 `http_req_duration` p95)만 보면
"느려졌다"는 것만 알고 "왜" 느려졌는지는 못 본다. `servers/monitoring`의
Prometheus/Grafana가 이미 아래 지표들을 긁고 있으니 테스트 중 같이 열어둘 것:

- **Kafka 컨슈머 랙** (kafka-exporter) — `normalizer-workers` 컨슈머 그룹의 랙이
  계속 늘어나면 normalizer가 유입 속도를 못 따라가고 있다는 뜻. 파티션이 전부
  1개라 이 그룹 안에서는 병렬 확장이 안 되는 구조라(트러블슈팅 글 참고), 여기서
  랙이 쌓이는 게 병목이면 다음 단계인 파티션 확장 작업의 근거 데이터가 된다.
- **컨테이너별 CPU/메모리** (cAdvisor) — otel-collector/normalizer/kafka 중 어디가
  먼저 한계에 부딪히는지.
- **호스트 전체 리소스** (node-exporter) — 단일 VM이라 특정 컨테이너가 아니라
  VM 자체가 한계일 수도 있다.
- **DB별 쿼리 부하** (postgres-exporter/clickhouse-exporter/opensearch-exporter) —
  platform-api.js 테스트 중 `/stats`, `/stats/timeseries`가 ClickHouse에 어떤
  부하를 주는지.

## 테스트 후 확인

`/stats/dlq-depth`, `/stats/unknown-depth`(둘 다 platform-api,
`app/pipeline_health_api.py`)를 테스트 전후로 비교한다. 부하 중에 DLQ나 unknown
토픽 깊이가 눈에 띄게 늘었다면, 단순히 "느려짐"이 아니라 "일부 이벤트가 처리
실패해서 버려지고 있다"는 신호라 훨씬 심각하게 봐야 한다.
