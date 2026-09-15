/**
 * platform-api 대시보드 API 부하 테스트 - 실제 대시보드가 폴링하는 엔드포인트들에
 * 동시 요청을 보내서 응답 시간(p95 등)과 백엔드(ClickHouse/OpenSearch/PostgreSQL)
 * 부하를 관찰한다.
 *
 * 이 경로는 otlp-ingest.js와 달리 Traefik(mTLS 아님 - forwardAuth + 게이트웨이
 * 시크릿)을 거쳐야 한다(servers/docker-compose.yml의 platform-api 라우터 라벨 참고).
 * setup()에서 실제 로그인(POST /api/auth/login)으로 세션 토큰을 한 번 발급받고,
 * 이후 모든 VU가 그 토큰을 Authorization: Bearer로 재사용한다 - app/auth.py의
 * /auth/verify가 Authorization 헤더만 본다(2026-07-21 이후 쿼리스트링 토큰 폴백
 * 제거됨).
 *
 * 실행 방법:
 *   TARGET_HOST=<도메인 또는 sslip.io 주소> K6_USERNAME=<계정> K6_PASSWORD=<비밀번호> \
 *     k6 run servers/loadtest/platform-api.js
 *
 * TARGET_HOST는 프로토콜 없이(예: 35-216-79-173.sslip.io) - HTTPS로 고정 요청한다
 * (Traefik의 websecure 엔트리포인트, letsencrypt 인증서 라우터 기준).
 *
 * K6_USERNAME/K6_PASSWORD는 이 리포에 없는 실제 운영 계정 정보라 반드시 env var로
 * 넘겨야 한다 - 스크립트에 하드코딩하지 않는다.
 */
import http from "k6/http";
import { check, sleep, fail } from "k6";

const TARGET_HOST = __ENV.TARGET_HOST;
const USERNAME = __ENV.K6_USERNAME;
const PASSWORD = __ENV.K6_PASSWORD;

if (!TARGET_HOST || !USERNAME || !PASSWORD) {
  throw new Error(
    "TARGET_HOST, K6_USERNAME, K6_PASSWORD env var가 모두 필요합니다."
  );
}

const BASE_URL = `https://${TARGET_HOST}/api`;

export const options = {
  vus: Number(__ENV.VUS || 20),
  duration: __ENV.DURATION || "60s",
  thresholds: {
    // 대시보드가 실사용자에게 "느리다"고 느껴지는 기준을 p95 800ms로 잡았다 -
    // ClickHouse 집계 쿼리(GET /stats, /stats/timeseries)가 병목이면 여기서 걸린다.
    http_req_duration: ["p(95)<800"],
    http_req_failed: ["rate<0.01"],
  },
};

// k6는 VU마다 독립 실행되지만, setup()의 반환값은 모든 VU에 읽기 전용으로 공유된다 -
// 로그인은 딱 한 번만 하고 토큰을 재사용한다(각 VU가 매 iteration마다 로그인하면
// 그 자체가 부하 테스트의 병목이 되어 정작 보려는 조회 성능을 왜곡시킨다).
export function setup() {
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ username: USERNAME, password: PASSWORD }),
    { headers: { "Content-Type": "application/json" } }
  );

  if (res.status !== 200) {
    fail(`로그인 실패 (status=${res.status}): ${res.body}`);
  }

  const token = JSON.parse(res.body).token;
  return { token };
}

export default function (data) {
  const headers = { Authorization: `Bearer ${data.token}` };

  const responses = http.batch([
    ["GET", `${BASE_URL}/stats`, null, { headers }],
    ["GET", `${BASE_URL}/stats/timeseries?range=24h`, null, { headers }],
    ["GET", `${BASE_URL}/events/recent?limit=50`, null, { headers }],
    ["GET", `${BASE_URL}/incidents`, null, { headers }],
    ["GET", `${BASE_URL}/stats/consumer-lag`, null, { headers }],
  ]);

  responses.forEach((res, i) => {
    check(res, {
      [`request ${i} status is 200`]: (r) => r.status === 200,
    });
  });

  sleep(1);
}
