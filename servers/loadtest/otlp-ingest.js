/**
 * OTLP 로그 수집 경로 부하 테스트 (otel-collector -> Kafka -> normalizer -> 저장소).
 *
 * otel-config.yaml 기준 HTTP(4318) 포트는 Traefik/mTLS를 거치지 않고 호스트에 직접
 * 노출돼 있다(servers/otel/docker-compose.yml의 "ports: 4318:4318" 참고 - gRPC(4317)만
 * h2c 이슈 때문에 Traefik을 거친다) - 그래서 이 스크립트는 인증서 없이 대상 서버의
 * 4318 포트로 바로 OTLP JSON을 쏜다. cloud-forwarder(app/forwarder.py)가 실제로
 * 보내는 것과 동일한 페이로드 형태(resourceLogs -> scopeLogs -> logRecords,
 * body.stringValue)를 그대로 흉내낸다.
 *
 * 실행 방법 (k6 설치 필요: https://k6.io/docs/get-started/installation/):
 *   TARGET_HOST=<GCP 서버 IP 또는 도메인> k6 run servers/loadtest/otlp-ingest.js
 *
 * 조절 가능한 env var:
 *   TARGET_HOST (필수)  - 예: 35.216.79.173 또는 35-216-79-173.sslip.io
 *   VUS         (기본 20)   - 동시 가상 사용자 수
 *   DURATION    (기본 60s)  - 테스트 지속 시간
 *
 * 예: TARGET_HOST=35.216.79.173 VUS=50 DURATION=2m k6 run servers/loadtest/otlp-ingest.js
 */
import http from "k6/http";
import { check, sleep } from "k6";

const TARGET_HOST = __ENV.TARGET_HOST;
if (!TARGET_HOST) {
  throw new Error("TARGET_HOST env var가 필요합니다 (예: TARGET_HOST=35.216.79.173)");
}

const ENDPOINT = `http://${TARGET_HOST}:4318/v1/logs`;

export const options = {
  vus: Number(__ENV.VUS || 20),
  duration: __ENV.DURATION || "60s",
  thresholds: {
    // otel-config.yaml의 batch timeout(500ms)이 실제로 감당할 수 있는지 보려는
    // 목적이라, p95가 크게 튀면(예: 1초 이상) 배치 큐가 밀리고 있다는 신호다.
    http_req_duration: ["p(95)<1000"],
    http_req_failed: ["rate<0.01"],
  },
};

function randomIp() {
  return `203.0.113.${Math.floor(Math.random() * 254) + 1}`;
}

function nowIso() {
  return new Date().toISOString();
}

function nowUnixNano() {
  // k6/JS는 나노초 정밀도가 없어서 밀리초를 1e6배 해서 근사한다 - dedupe 해시가
  // "충분히 서로 다른 값"이면 되는 용도라 진짜 나노초일 필요는 없다.
  return String(Date.now() * 1e6 + Math.floor(Math.random() * 1e6));
}

// 실제 normalizer/app/normalizer.py의 각 normalize_*()가 기대하는 wire 필드명과
// 최대한 맞춰서, 부하 테스트 트래픽이 실제로 normalize까지 성공하고 Kafka/OpenSearch/
// ClickHouse까지 흘러가는 걸 대시보드에서 관찰할 수 있게 한다(단순 가비지 바이트로
// 인입 처리량만 재는 것보다 실제 상황에 가깝다).
const BODY_BUILDERS = {
  was: () =>
    JSON.stringify({
      time: nowIso(),
      method: "GET",
      path: "/rest/products/search",
      query: `q=${Math.random().toString(36).slice(2, 8)}`,
      status: Math.random() < 0.1 ? 500 : 200,
      remote_addr: randomIp(),
      referrer: "-",
      body_bytes_sent: Math.floor(Math.random() * 5000),
      user_agent: "k6-load-test/1.0",
      request_time: (Math.random() * 0.5).toFixed(3),
    }),
  waf: () =>
    JSON.stringify({
      timestamp: nowIso(),
      attack_type: "sql_injection",
      risk_level: ["LOW", "MEDIUM", "CRITICAL"][Math.floor(Math.random() * 3)],
      matched_rule_id: "sqli_union_select",
      matched_rule_name: "SQL Injection: UNION SELECT",
      payload_snippet: "' UNION SELECT * FROM users--",
      target_endpoint: "/rest/products/search",
      http_method: "GET",
      user_agent: "k6-load-test/1.0",
      blocked: true,
      mode: "prevention",
      source_ip: randomIp(),
    }),
  falco: () =>
    JSON.stringify({
      time: nowIso(),
      rule: "Terminal shell in container",
      priority: ["Warning", "Notice", "Critical"][Math.floor(Math.random() * 3)],
      tags: ["container", "shell"],
      output_fields: {
        "k8s.ns.name": "default",
        "k8s.pod.name": `juice-shop-${Math.floor(Math.random() * 1000)}`,
        "user.name": "root",
      },
    }),
  audit: () =>
    JSON.stringify({
      stage: "ResponseComplete",
      stageTimestamp: nowIso(),
      verb: "get",
      objectRef: { resource: "pods", namespace: "default", name: `app-${Math.floor(Math.random() * 100)}` },
      responseStatus: { code: 200 },
      sourceIPs: [randomIp()],
      user: { username: "k6-load-test", groups: ["system:authenticated"] },
    }),
  cloud: () =>
    JSON.stringify({
      insertId: `k6-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      timestamp: nowIso(),
      resource: { type: "gce_firewall_rule", labels: { project_id: "sentinel-ops-loadtest" } },
      protoPayload: {
        methodName: "v1.compute.firewalls.insert",
        serviceName: "compute.googleapis.com",
        resourceName: "projects/sentinel-ops-loadtest/global/firewalls/allow-all",
        authenticationInfo: { principalEmail: "k6-load-test@example.com" },
        requestMetadata: { callerIp: randomIp() },
      },
    }),
};

// otel-config.yaml routing connector가 매칭하는 log.source 값 그대로 - was/waf/
// falco/k8s-audit는 Target 쪽 otel-collector가, cloud-audit는 cloud-forwarder가
// 태깅하는 값과 동일해야 라우팅이 실제로 걸린다.
const SOURCES = [
  { tag: "was", build: BODY_BUILDERS.was },
  { tag: "waf", build: BODY_BUILDERS.waf },
  { tag: "falco", build: BODY_BUILDERS.falco },
  { tag: "k8s-audit", build: BODY_BUILDERS.audit },
  { tag: "cloud-audit", build: BODY_BUILDERS.cloud },
];

function buildOtlpPayload(source) {
  const ts = nowUnixNano();
  return JSON.stringify({
    resourceLogs: [
      {
        resource: {
          attributes: [{ key: "log.source", value: { stringValue: source.tag } }],
        },
        scopeLogs: [
          {
            logRecords: [
              {
                timeUnixNano: ts,
                observedTimeUnixNano: ts,
                body: { stringValue: source.build() },
              },
            ],
          },
        ],
      },
    ],
  });
}

export default function () {
  const source = SOURCES[Math.floor(Math.random() * SOURCES.length)];
  const payload = buildOtlpPayload(source);

  const res = http.post(ENDPOINT, payload, {
    headers: { "Content-Type": "application/json" },
  });

  check(res, {
    "status is 200": (r) => r.status === 200,
  });

  sleep(0.1);
}
