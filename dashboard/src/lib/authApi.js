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
// table — "직결, 디버깅용"). CORS is already wide open on the backend
// (CORS_ALLOWED_ORIGINS=*) so a cross-origin absolute URL works fine.
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
// 지금 platform-api(servers/platform-api/app/*.py)는 auth.py 말고는 실제로
// Authorization을 검사하는 라우트가 아직 없다(README "아직 안 된 것" — RBAC
// 미반영). 그래도 헤더를 항상 붙여두면 나중에 백엔드가 role 체크를 추가했을 때
// 프론트를 고칠 필요가 없다.
export async function apiFetch(path, { method = "GET", body, headers = {}, skipAuth = false } = {}) {
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
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const apiGet = (path) => apiFetch(path);
export const apiPost = (path, body) => apiFetch(path, { method: "POST", body });
export const apiPatch = (path, body) => apiFetch(path, { method: "PATCH", body });
export const apiDelete = (path) => apiFetch(path, { method: "DELETE" });

// ---- /auth/* (servers/platform-api/app/auth.py) ----

// {username, password} -> {token}. 백엔드가 단일 관리자 계정 스텁이라 로그인에
// 성공하면 곧 그 admin 계정이다.
export function login(username, password) {
  return apiFetch("/auth/login", { method: "POST", body: { username, password }, skipAuth: true });
}

// -> {valid, username?}. role 필드는 없음(백엔드에 RBAC가 아직 없어서) — 나중에
// 추가되면 AuthContext.jsx의 isAdmin 계산 한 줄만 바꾸면 된다.
export function fetchSession() {
  return apiFetch("/auth/session");
}

// 서버 쪽 토큰 폐기는 best-effort — 이미 만료됐거나 네트워크가 끊겨 있어도
// 로컬 로그아웃 자체는 항상 성공해야 하므로 실패를 삼킨다.
export function logout() {
  return apiFetch("/auth/logout", { method: "POST" }).catch(() => {});
}

// ---- WebSocket ----

// /ws/incidents(상관분석 발화 릴레이)에 쿼리스트링으로 토큰을 붙여서 접속
// URL을 만든다. 브라우저 WebSocket API는 연결 실패 사유(401/403 등)를 코드로
// 읽을 방법이 없어서, 실제로 열기 전에 fetchSession()으로 토큰이 아직
// 유효한지 먼저 확인하는 걸 권장 — 호출부에서 fetchSession() 성공 후에만
// 이 함수로 연결하면 됨.
//
// 참고: /ws/events는 servers/platform-api에 아직 라우터가 없다(현재는
// /ws/incidents만 존재, app/websocket.py). 필요해지면 그때 이 헬퍼를
// 그대로 재사용하면 된다.
export function wsUrl(path) {
  const token = getToken();
  const query = token ? `?token=${encodeURIComponent(token)}` : "";
  if (/^https?:\/\//.test(API_BASE)) {
    return `${API_BASE.replace(/^http/, "ws")}${path}${query}`;
  }
  const origin = window.location.origin.replace(/^http/, "ws");
  return `${origin}${API_BASE}${path}${query}`;
}
