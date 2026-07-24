// API client for servers/platform-api (see repo root README.md "프론트엔드
// 연동 API"). Traefik proxies everything under `/api/*` to platform-api with
// the `/api` prefix stripped, so hitting `${API_BASE}/auth/login` through
// Traefik means calling platform-api's `POST /auth/login`.
//
// Base URL is overridable via VITE_API_BASE_URL (dashboard/.env, see
// .env.example) — defaults to the same-origin `/api` path, which is correct
// once the dashboard is served as a sibling Traefik-routed service. For
// local `npm run dev` (separate Vite port, no Traefik in front of it), set
// VITE_API_BASE_URL to either `http://localhost/api` (through Traefik) or
// `http://localhost:8400` (straight to platform-api, per README's port
// table — "직결, 디버깅용". Bound to the docker host's 127.0.0.1 only —
// SSH tunnel it (ssh -L 8400:localhost:8400 <host>) if the compose stack
// runs on a remote host like the GCP VM). CORS is already wide open on the
// backend (CORS_ALLOWED_ORIGINS=*) so a cross-origin absolute URL works fine.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

const TOKEN_KEY = "sentinel_ops_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(status, detail) {
    super(detail || `API error ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

// 모든 REST 호출이 거쳐가는 단일 지점 — 토큰이 있으면 Authorization: Bearer
// 헤더를 자동으로 붙인다. 401(토큰 만료/무효)이면 로컬 토큰을 지우고 전역
// 이벤트를 쏴서 AuthContext가 즉시 로그인 화면으로 돌려보내게 하고, 403(권한
// 부족)이면 그대로 던져서 호출한 쪽(주로 admin 전용 쓰기 액션)이 "권한 없음"
// 토스트를 띄우게 한다.
//
// Authorization 검사는 platform-api 앱이 아니라 Traefik의 forwardAuth
// 미들웨어가 /api/auth/*, /api/health를 뺀 모든 /api/*에서 한다(auth.py의
// GET /verify, 2026-07-14부터 - README "프론트엔드 연동 API" 절 참고). 여기서
// 헤더를 항상 붙여주는 건 그 검사를 통과하기 위해서다 - 안 붙이면 401.
async function apiFetchRaw(path, { method = "GET", body, headers = {}, skipAuth = false } = {}) {
  const token = getToken();
  const finalHeaders = { ...headers };
  if (body !== undefined) finalHeaders["Content-Type"] = "application/json";
  if (token && !skipAuth) finalHeaders["Authorization"] = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: finalHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    throw new ApiError(0, "백엔드에 연결할 수 없습니다. platform-api/Traefik이 떠 있는지 확인해주세요.");
  }

  if (res.status === 401) {
    setToken(null);
    window.dispatchEvent(new CustomEvent("sentinel-ops:unauthorized"));
    throw new ApiError(401, "인증이 만료됐습니다. 다시 로그인해주세요.");
  }
  if (res.status === 403) {
    throw new ApiError(403, "이 작업은 관리자 권한이 필요합니다.");
  }
  if (!res.ok) {
    let detail;
    try {
      detail = (await res.json())?.detail;
    } catch {
      /* 본문이 JSON이 아니면 무시 */
    }
    throw new ApiError(res.status, detail || `요청 실패 (${res.status})`);
  }
  const body_ = res.status === 204 ? null : await res.text().then((t) => (t ? JSON.parse(t) : null));
  return { body: body_, res };
}

export async function apiFetch(path, opts) {
  const { body } = await apiFetchRaw(path, opts);
  return body;
}

// GET 하나에 여러 위젯/훅이 동시에(같은 폴링 tick에) 동일한 경로를 요청하는 경우가
// 있다(예: Overview의 "Log Levels"/"심각도 분포"가 둘 다 독립적으로 GET
// /stats/levels?hours=24를 2초마다 부름, 2026-07-24 "심각도 분포만 유독 느리다"
// 피드백으로 실측 확인 - 같은 URL로 동시에 여러 요청이 나가는 유일한 경로였음).
// 이미 같은 경로로 나가 있는 요청이 있으면 새로 fetch를 또 열지 않고 그 Promise를
// 그대로 공유한다 - GET은 멱등이라 안전하고, SWR/React Query 등이 기본으로 하는
// in-flight 요청 중복 제거와 같은 패턴이다. 완전한 응답 캐싱은 아니다(settle되는
// 즉시 맵에서 지워서 다음 폴링 tick은 새로 요청함) - 순수하게 "동시에 뜬 동일
// 요청끼리만" 하나로 묶는다.
const _inflightGets = new Map();

export function apiGet(path) {
  const existing = _inflightGets.get(path);
  if (existing) return existing;
  const promise = apiFetch(path).finally(() => {
    _inflightGets.delete(path);
  });
  _inflightGets.set(path, promise);
  return promise;
}
export const apiPost = (path, body) => apiFetch(path, { method: "POST", body });
export const apiPatch = (path, body) => apiFetch(path, { method: "PATCH", body });
export const apiDelete = (path) => apiFetch(path, { method: "DELETE" });

// app/pagination.py의 X-Next-Cursor 커서 페이지네이션을 쓰는 목록 엔드포인트용 -
// apiGet과 달리 다음 페이지 커서(없으면 null)까지 같이 돌려준다.
export async function apiGetPaged(path) {
  const { body, res } = await apiFetchRaw(path);
  return { data: body ?? [], nextCursor: res.headers.get("X-Next-Cursor") };
}

// X-Next-Cursor가 있는 동안 계속 다음 페이지를 이어 받아 전체 목록을 배열 하나로
// 합쳐서 돌려준다 - 목록 전체를 클라이언트에서 집계(총 개수/상태별 카운트/그룹핑
// 등)해야 하는 화면(useIncidents.js, useIncidentStats.js)용. limit은 이제 "한
// 페이지 크기"일 뿐인데(2026-07-15 페이지네이션 도입) 그걸 모르고 단일 페이지
// 응답을 "전체 목록"처럼 쓰면 그 이상 있는 데이터가 조용히 잘린다(2026-07-23,
// Total이 실제보다 낮게 찍히던 원인). 목록이 아주 커서(수천 건) 전부 불러오는 게
// 부담스러운 화면은 이 함수 대신 apiGetPaged를 페이지 단위로 써서 무한 스크롤을
// 구현한다(useTechniqueIncidents.js 참고).
export async function apiGetAllPages(path, params = {}) {
  let all = [];
  let cursor = null;
  do {
    const qs = new URLSearchParams(params);
    if (cursor) qs.set("cursor", cursor);
    const query = qs.toString();
    const { data, nextCursor } = await apiGetPaged(`${path}${query ? `?${query}` : ""}`);
    all = all.concat(data);
    cursor = nextCursor;
  } while (cursor);
  return all;
}

// ---- /auth/* (servers/platform-api/app/auth.py) ----

// {username, password} -> {token}. 백엔드가 users 테이블(role: admin/viewer)로
// 여러 계정을 지원한다(users_api.py) - 로그인 성공 = admin이 더 이상 아니다,
// 실제 role은 fetchSession()의 응답을 봐야 함.
export function login(username, password) {
  return apiFetch("/auth/login", { method: "POST", body: { username, password }, skipAuth: true });
}

// -> {valid, username?, role?}. role은 "admin" | "viewer"(2026-07-14부터 포함) -
// AuthContext.jsx가 이 값으로 isAdmin(role === "admin")을 계산한다.
export function fetchSession() {
  return apiFetch("/auth/session");
}

// 서버 쪽 토큰 폐기는 best-effort — 이미 만료됐거나 네트워크가 끊겨 있어도
// 로컬 로그아웃 자체는 항상 성공해야 하므로 실패를 삼킨다.
export function logout() {
  return apiFetch("/auth/logout", { method: "POST" }).catch(() => {});
}

// ---- /incidents (servers/platform-api/app/incidents_api.py) ----

// 인시던트 실시간 팝업은 WebSocket이 아니라 짧은 주기(3~5초) REST 폴링으로 구현한다
// (2026-07-13, servers 쪽에서 /ws/incidents 자체를 제거하고 GET /incidents?since=로
// 대체 — 일반 Authorization 헤더를 그대로 쓸 수 있어 WS 핸드셰이크의 `?token=` 우회가
// 필요 없어졌다). since를 안 주면 최신순 목록(기존 화면용), since(ISO8601)를 주면 그
// 시각 이후 생성된 인시던트만 오래된순으로 온다 — 호출부는 마지막으로 받은 항목의
// created_at을 다음 호출의 since로 그대로 넘기면 된다.
export function fetchIncidentsSince(since) {
  const qs = since ? `?since=${encodeURIComponent(since)}` : "";
  return apiGet(`/incidents${qs}`);
}

// ---- /events/recent (servers/platform-api/app/events_api.py) ----

// 개별 정규화 이벤트 실시간 티커(LiveTicker/App.jsx의 SidebarCriticalAlert용) — 인시던트
// 폴링(fetchIncidentsSince)과 같은 since 패턴의 REST 폴링이다(2026-07-14, WS
// /ws/events(구 app/event_stream.py) 제거 후 대체 — 계약 v1.1 §7. 일반
// Authorization 헤더를 그대로 쓰므로 WS 전용 쿼리스트링 토큰 처리(옛 wsUrl)가
// 더 이상 필요 없다). since를 안 주면 최신순 상위 limit건, since(ISO8601)를
// 주면 그 시각 이후 이벤트만 오래된순으로 온다.
export function fetchEventsSince(since, limit = 50) {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (since) qs.set("since", since);
  return apiGet(`/events/recent?${qs.toString()}`);
}

// event_id 하나가 어느 인시던트로 묶였는지 직접 조회 - idx_incident_events_event_id
// 인덱스(2026-07-17) 덕에 correlation_key 후보 추리기 없이 정확히 답한다. 아직
// correlation-engine이 처리 전이면 incident_id: null(에러 아님) - CRITICAL 토스트의
// "공격 스토리라인 보기" 버튼이 짧은 주기로 이걸 폴링해서 활성화 여부를 결정한다.
export function fetchEventIncident(eventId) {
  return apiGet(`/events/${encodeURIComponent(eventId)}/incident`);
}

// ---- /incidents/{id}/timeline (servers/platform-api/app/incidents_api.py) ----

// 공격 스토리라인(원본 로그 타임라인) - CriticalToastStack의 "스토리라인 보기"가
// 탭을 전환하기 전에 이걸로 먼저 데이터가 있는지 확인해서, 이동하는 순간 바로
// 채워진 화면이 보이게 한다(useIncidentTimeline.js와 같은 엔드포인트, 이쪽은
// 버튼의 로딩 상태 표시가 목적이라 훅이 아니라 일회성 호출로 따로 둠).
export function fetchIncidentTimeline(incidentId) {
  return apiGet(`/incidents/${encodeURIComponent(incidentId)}/timeline`);
}
