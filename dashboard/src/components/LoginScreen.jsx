import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";

// servers/platform-api/app/auth.py 기준 — users 테이블(pgcrypto) 실사용자 로그인.
// 초기 관리자 계정은 postgres init/005-seed-admin-user.sh가
// ADMIN_INITIAL_PASSWORD(.env)로 시드한다 - 화면에 기본 자격증명을 노출하지 않는다.
export default function LoginScreen() {
  const { login, error } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // 2026-07-16: 로고(public/logo.png)가 아직 안 올라와 있을 수도 있으니, 이미지
  // 로드가 실패하면 기존의 민트 사각 아이콘으로 조용히 대체 - 깨진 이미지 아이콘이
  // 그대로 노출되는 것보다 낫다.
  const [logoFailed, setLogoFailed] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!username || !password || submitting) return;
    setSubmitting(true);
    await login(username, password);
    setSubmitting(false);
  }

  return (
    // 2026-07-16: 대각선으로 흰색/검정 절반씩 나뉜 배경 - linear-gradient에
    // 같은 색을 50% 지점에서 하드 스톱으로 두 번 줘서 그라데이션이 아니라
    // 또렷한 경계선으로 갈라지게 했다. 135deg = 좌상단 흰색, 우하단 검정.
    // 여기에 은은한 민트/퍼플 글로우를 얹어 로그인 페이지만 밋밋하지 않게.
    <div
      className="min-h-screen relative flex items-center justify-center px-4 overflow-hidden"
      style={{ background: "linear-gradient(135deg, #F4F5FA 0%, #F4F5FA 50%, #05060B 50%, #05060B 100%)" }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 55% 45% at 82% 18%, rgb(0 255 166 / 0.16), transparent), radial-gradient(ellipse 50% 40% at 18% 82%, rgb(166 77 255 / 0.14), transparent)",
        }}
      />

      <div className="relative w-full max-w-sm">
        {/* 로고+서비스 설명 블록은 대각선 경계를 가로지를 수 있어서 자체적으로
            반투명 다크 글래스 배경을 깔았다 - 밑에 흰색/검정 어느 쪽이 있어도
            흰 글자가 항상 또렷하게 읽히도록. */}
        <div className="flex flex-col items-center text-center gap-3 mb-6 bg-black/35 backdrop-blur-md rounded-2xl px-6 py-6 border border-white/10 shadow-xl">
          {!logoFailed ? (
            <img
              src="/logo.png"
              alt="SENTINEL-OPS"
              onError={() => setLogoFailed(true)}
              className="w-16 h-16 rounded-2xl object-cover shadow-lg"
            />
          ) : (
            <div className="w-14 h-14 rounded-2xl bg-dash-mint/20 flex items-center justify-center shrink-0 glow-box-mint">
              <span className="w-5 h-5 rounded-sm bg-dash-mint" />
            </div>
          )}
          <div>
            <p className="text-white font-semibold text-lg leading-none tracking-wide glow-mint">SENTINEL-OPS</p>
            <p className="text-white/75 text-xs mt-2 leading-relaxed">
              WAS · WAF · Falco · K8s Audit 로그를 실시간으로 모아 상관분석하고,
              <br />
              공격을 하나의 인시던트로 재구성해 조기에 탐지하는 보안 관제 대시보드
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="bg-dash-surface/95 backdrop-blur-md rounded-2xl p-6 space-y-4 shadow-2xl">
          <div>
            <label className="text-dash-muted text-xs block mb-1.5">아이디</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              className="w-full bg-dash-bg text-dash-fg text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-1 focus:ring-dash-mint"
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
      </div>
    </div>
  );
}
