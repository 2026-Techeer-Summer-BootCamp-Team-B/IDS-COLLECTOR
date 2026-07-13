import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getToken, setToken as persistToken, login as apiLogin, fetchSession, logout as apiLogout } from "../lib/authApi";

const AuthContext = createContext(null);

/**
 * 앱 전역 인증 상태. 부팅 시 저장된 토큰이 있으면 GET /auth/session으로
 * 유효성을 먼저 검증하고(#4), apiFetch(#2)가 401을 받으면 쏘는
 * "sentinel-ops:unauthorized" 이벤트를 들어서 즉시 로그아웃 처리한다.
 *
 * isAdmin: platform-api의 /auth/session이 이제 role 필드를 실제로 내려준다
 * (auth.py SessionResponse, Traefik forwardAuth가 GET /auth/verify에서 검증하는
 * role과 같은 값 — 쓰기 라우트는 서버에서도 role=admin만 통과시킨다). 그래서
 * "로그인 성공 = admin"이 아니라 실제 role을 저장했다가 그걸로 판정한다 - viewer로
 * 로그인하면 관리자 전용 버튼(룰 토글/인시던트 상태변경/IP 차단 등)이 눌려도
 * 어차피 서버가 403을 내는데, 프론트에서 미리 안 보여주는 게 UX상 맞다.
 */
export function AuthProvider({ children }) {
  const [status, setStatus] = useState("loading"); // loading | authenticated | unauthenticated
  const [username, setUsername] = useState(null);
  const [role, setRole] = useState(null);
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
        setRole(session.role ?? null);
        setStatus("authenticated");
      } else {
        persistToken(null);
        setUsername(null);
        setRole(null);
        setStatus("unauthenticated");
      }
    } catch {
      // 세션 체크 자체가 실패(네트워크 끊김 등)해도 안전하게 로그아웃 취급.
      persistToken(null);
      setUsername(null);
      setRole(null);
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
    setRole(null);
    setStatus("unauthenticated");
  }

  const isAdmin = status === "authenticated" && role === "admin";

  return (
    <AuthContext.Provider value={{ status, username, role, error, isAdmin, login, logout, retry: checkSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth는 AuthProvider 안에서만 쓸 수 있습니다.");
  return ctx;
}
