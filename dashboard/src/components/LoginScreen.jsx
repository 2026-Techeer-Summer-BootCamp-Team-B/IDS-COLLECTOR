import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";

// servers/platform-api/app/auth.py 기준 — 기본 계정은 admin/changeme
// (servers/platform-api/app/config.py의 admin_username/admin_password 기본값,
// 배포 시 환경변수로 바꿀 것).
export default function LoginScreen() {
  const { login, error } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!username || !password || submitting) return;
    setSubmitting(true);
    await login(username, password);
    setSubmitting(false);
  }

  return (
    <div className="min-h-screen bg-dash-bg flex items-center justify-center px-4 font-sans">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8 justify-center">
          <div className="w-9 h-9 rounded-lg bg-dash-mint/20 flex items-center justify-center shrink-0 glow-box-mint">
            <span className="w-3.5 h-3.5 rounded-sm bg-dash-mint" />
          </div>
          <div>
            <p className="text-dash-fg font-semibold text-base leading-none tracking-wide glow-mint">SENTINEL-OPS</p>
            <p className="text-dash-muted text-[11px] mt-1">보안 로그 상관분석 대시보드</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="bg-dash-surface rounded-2xl p-6 space-y-4">
          <div>
            <label className="text-dash-muted text-xs block mb-1.5">아이디</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              className="w-full bg-dash-bg text-dash-fg text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-1 focus:ring-dash-mint"
              placeholder="admin"
            />
          </div>
          <div>
            <label className="text-dash-muted text-xs block mb-1.5">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full bg-dash-bg text-dash-fg text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-1 focus:ring-dash-mint"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-dash-critical text-xs bg-dash-critical/10 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={!username || !password || submitting}
            className="w-full text-sm font-medium py-2.5 rounded-lg bg-dash-mint/15 text-dash-mint hover:bg-dash-mint/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "로그인 중..." : "로그인"}
          </button>
        </form>

        <p className="text-dash-faint text-[11px] text-center mt-4">
          servers/platform-api 인증 스텁 · 기본 계정 admin/changeme
        </p>
      </div>
    </div>
  );
}
