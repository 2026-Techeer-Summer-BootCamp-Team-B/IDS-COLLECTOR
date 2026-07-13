import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getToken, setToken as persistToken, login as apiLogin, fetchSession, logout as apiLogout } from "../lib/authApi";

const AuthContext = createContext(null);

/**
 * 앱 전역 인증 상태. 부팅 시 저장된 토큰이 있으면 GET /auth/session으로
 * 유효성을 먼저 검증하고(#4), apiFetch(#2)가 401을 받으면 쏘는
 * "sentinel-ops:unauthorized" 이벤트를 들어서 즉시 로그아웃 처리한다.
 *
 * isAdmin: platform-api의 /auth/session 응답에는 role 필드가 없다 (단일
 * 관리자 계정 스텁, README "아직 안 된 것 — 인증(P5-2): 역할(RBAC) 모델
 * 미반영" 참고). 그래서 지금은 "로그인 성공 = admin"으로 취급한다. 나중에
 * 백엔드가 session 응답에 role을 내려주기 시작하면 아래 isAdmin 계산 한 줄만
 * `session.role === "admin"`으로 바꾸면 된다 — 그 외 코드(쓰기 액션 가드 등)는
 * 전부 이 값만 참조하므로 손댈 필요 없음.
 */
export function AuthProvider({ children }) {
  const [status, setStatus] = useState("loading"); // loading | authenticated | unauthenticated
  const [username, setUsername] = useState(null);
  const [error, setError] = useState(null);

  const checkSession = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setStatus("unauthenticated");
      return;
    }
    try {
      const session = await fetchSession();
      if (session.valid) {
        setUsername(session.username ?? null);
        setStatus("authenticated");
      } else {
        persistToken(null);
        setUsername(null);
        setStatus("unauthenticated");
      }
    } catch {
      // 세션 체크 자체가 실패(네트워크 끊김 등)해도 안전하게 로그아웃 취급.
      persistToken(null);
      setUsername(null);
      setStatus("unauthenticated");
    }
  }, []);

  useEffect(() => {
    checkSession();
    function handleUnauthorized() {
      setUsername(null);
      setStatus("unauthenticated");
    }
    window.addEventListener("sentinel-ops:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("sentinel-ops:unauthorized", handleUnauthorized);
  }, [checkSession]);

  async function login(usernameInput, password) {
    setError(null);
    try {
      const { token } = await apiLogin(usernameInput, password);
      persistToken(token);
      await checkSession();
      return true;
    } catch (e) {
      setError(e.detail || e.message || "로그인에 실패했습니다.");
      return false;
    }
  }

  async function logout() {
    await apiLogout();
    persistToken(null);
    setUsername(null);
    setStatus("unauthenticated");
  }

  const isAdmin = status === "authenticated";

  return (
    <AuthContext.Provider value={{ status, username, error, isAdmin, login, logout, retry: checkSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth는 AuthProvider 안에서만 쓸 수 있습니다.");
  return ctx;
}
