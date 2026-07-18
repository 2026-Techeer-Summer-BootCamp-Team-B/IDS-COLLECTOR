import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame } from "remotion";

// ---- 영상 스펙 ----
// 발표 오프닝(문제의식 슬라이드 전)에 트는 인트로 영상.
// (2026-07-18 5차 수정: 흰 배경 TV 속보 그래픽을 전면 폐기하고, 어두운 배경에서
//  가상의 사용자가 모니터 앞에서 타이핑하듯 터미널 로그가 한 줄씩 찍히는 연출로
//  교체. 스토리 전환은 화면이 옆으로 넘어가는 슬라이드 트랜지션. 결론 장면은
//  "더 강한 방어 vs 더 빠른 인지" 대비 구도를 버리고 레이더가 위협을 잡아내
//  방어로 이어지는 단일 내러티브로 재구성 + 문구 단순화. 검정 배경만 있던
//  구간들에 은은하게 떠다니는 글로우 블롭을 추가해 밋밋함을 줄임.
//  2026-07-18 6차: 카드별 노출 시간을 225→195프레임으로 줄여 마지막 정보가 뜬
//  뒤 다음 카드로 넘어가기 전 정지 구간을 약 1.5초로 단축. 결론 장면("빠르게
//  찾아 방어하는 것입니다")은 "우리가 주목하는 건" 바로 다음에 이어지도록
//  당기고, 문구가 다 뜬 뒤엔 페이드아웃 전 1초 정도 붙잡아둠 - 총 길이도
//  그만큼 줄어듦.
//  2026-07-18 7차: 카드 4개 합쳐 25초가량이던 걸 20초로(카드당 5초) 추가 단축.
//  결론 장면(아이콘+텍스트)을 더 키우고, 마지막 SENTINEL-OPS 로고가 영상이
//  끝나는 순간 확대되며 페이드아웃되도록 엔딩 연출 추가.)
export const BREACH_FPS = 30;
export const BREACH_WIDTH = 1920;
export const BREACH_HEIGHT = 1080;
export const BREACH_TOTAL_FRAMES = 1090; // 약 36초

// ---- 컬러 팔레트 ----
const COLORS = {
  bg: "#030305",
  bgDeep: "#0D0D10",
  bgAlt: "#16161B",
  mint: "#00FFA6",
  pink: "#A64DFF",
  was: "#00C2FF", // 방어 / SENTINEL-OPS 블루 포인트 (어두운 배경용)
  wasDeep: "#0B63F6", // 흰 화면 위 텍스트용 진한 블루 (대비 확보)
  high: "#FF7A18",
  critical: "#FF1F4B",
  line: "#5A6288",
  text: "#F2F5FF",
  textDim: "#8890B5",
  ink: "#101216", // 모니터 화면(흰 배경) 위 본문 텍스트
  inkGray: "#8A8F98", // 모니터 화면 위 보조 텍스트
};

const MONO = "'SF Mono', 'Menlo', monospace";
const SANS = "'Noto Sans KR', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const clamp01 = (v) => Math.min(1, Math.max(0, v));

function progressBetween(frame, start, end) {
  if (end <= start) return frame >= end ? 1 : 0;
  return interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

function sr(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function fmtCount(n) {
  return Math.max(0, Math.round(n)).toLocaleString("en-US");
}

// ---- 배경: 어두운 그라디언트 + 점 격자 + 은은하게 떠다니는 글로우 블롭 ----
function CyberBackground({ frame = 0 }) {
  const blobs = [
    { cx: 0.22, cy: 0.28, r: 520, color: COLORS.mint, fx: 0.0021, fy: 0.0017, ph: 0 },
    { cx: 0.78, cy: 0.22, r: 460, color: COLORS.was, fx: 0.0016, fy: 0.0023, ph: 2.1 },
    { cx: 0.5, cy: 0.85, r: 560, color: COLORS.pink, fx: 0.0019, fy: 0.0014, ph: 4.4 },
  ];
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(circle, ${COLORS.line}33 1px, transparent 1px)`,
          backgroundSize: "48px 48px",
          opacity: 0.4,
        }}
      />
      {blobs.map((b, i) => {
        const x = (b.cx + Math.sin(frame * b.fx + b.ph) * 0.05) * BREACH_WIDTH;
        const y = (b.cy + Math.cos(frame * b.fy + b.ph) * 0.05) * BREACH_HEIGHT;
        const breathe = 1 + Math.sin(frame * 0.01 + b.ph) * 0.08;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x - b.r,
              top: y - b.r,
              width: b.r * 2,
              height: b.r * 2,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${b.color}22 0%, ${b.color}00 70%)`,
              transform: `scale(${breathe})`,
            }}
          />
        );
      })}
      <AbsoluteFill
        style={{ background: `radial-gradient(ellipse at 50% 50%, ${COLORS.bg}00 0%, ${COLORS.bgDeep}cc 85%)` }}
      />
    </AbsoluteFill>
  );
}

// =====================================================================
// 모니터 앞에 앉은 가상의 사용자 - 페르시스턴트 셸 (4개 스토리 내내 유지되고
// 화면 속 터미널 내용만 스토리별로 슬라이드 전환된다)
// =====================================================================
// 유출 건수 카운트업 값 계산 (0~60%: 슬롯머신처럼 랜덤 스크램블, 60~100%: 실제
// 숫자로 ease-out 안착) - 모던 카드 스타일로 바뀌면서도 이 효과는 그대로 유지.
function useCountValue(frame, startFrame, duration, target) {
  const local = frame - startFrame;
  const t = clamp01(local / duration);
  if (t <= 0) return 0;
  if (t < 0.6) {
    const digits = String(target).length;
    const seedFrame = Math.floor(frame / 2);
    return Math.floor(sr(seedFrame * 0.37 + startFrame * 1.13) * Math.pow(10, digits));
  }
  const localT = (t - 0.6) / 0.4;
  const eased = 1 - Math.pow(1 - clamp01(localT), 3);
  return Math.round(target * eased);
}

// 흰 화면 안, 알림 카드 뒤편을 채우는 아주 은은한 배경 장식 (커졌을 때 휑해
// 보이지 않도록 - 카드보다 훨씬 연하게 깔려서 시선을 뺏지 않는다)
function ScreenDecor() {
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      {/* 우상단 - 연관성 조사 모티프의 대형 돋보기 */}
      <svg
        width={300}
        height={300}
        viewBox="-70 -70 140 140"
        style={{ position: "absolute", right: -30, top: -30, overflow: "visible" }}
      >
        <circle cx={-10} cy={-10} r={36} fill="none" stroke={COLORS.wasDeep} strokeWidth={9} opacity={0.07} />
        <line x1={18} y1={18} x2={48} y2={48} stroke={COLORS.wasDeep} strokeWidth={12} strokeLinecap="round" opacity={0.07} />
      </svg>

      {/* 좌하단 - 로그 데이터를 암시하는 작은 막대 그래프 실루엣 */}
      <svg width={220} height={140} style={{ position: "absolute", left: 40, bottom: 30 }}>
        {[0.35, 0.6, 0.42, 0.78, 0.55].map((h, i) => (
          <rect
            key={i}
            x={i * 42}
            y={140 - 140 * h}
            width={26}
            height={140 * h}
            rx={4}
            fill={COLORS.inkGray}
            opacity={0.08}
          />
        ))}
      </svg>

      {/* 우하단 - 옅은 브랜드 워터마크 */}
      <div
        style={{
          position: "absolute",
          right: 44,
          bottom: 34,
          fontFamily: MONO,
          fontSize: 20,
          fontWeight: 800,
          letterSpacing: 3,
          color: COLORS.inkGray,
          opacity: 0.14,
        }}
      >
        SENTINEL-OPS
      </div>

      {/* 좌상단 - 은은한 브랜드 컬러 글로우로 화면에 온기 추가 */}
      <div
        style={{
          position: "absolute",
          left: -120,
          top: -140,
          width: 380,
          height: 380,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${COLORS.mint}14 0%, transparent 70%)`,
        }}
      />
    </div>
  );
}

// 모니터 화면 상단 앱 바 - 트래픽 라이트 점 + 앱 이름으로 "세련된 앱 화면" 느낌
function AppTopBar() {
  const dotColors = ["#FF5F57", "#FEBC2E", "#28C840"];
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 48,
        background: "#F2F3F6",
        borderBottom: "1px solid #E4E6EC",
        display: "flex",
        alignItems: "center",
        paddingLeft: 20,
      }}
    >
      <div style={{ display: "flex", gap: 8 }}>
        {dotColors.map((c) => (
          <div key={c} style={{ width: 11, height: 11, borderRadius: "50%", background: c }} />
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: SANS,
          fontSize: 14,
          fontWeight: 700,
          color: COLORS.inkGray,
          letterSpacing: 0.5,
        }}
      >
        SENTINEL-OPS · Live Feed
      </div>
    </div>
  );
}

function MonitorShell({ frame, startFrame, endFrame, children }) {
  const local = frame - startFrame;
  const total = endFrame - startFrame;
  if (local < -10 || local > total + 10) return null;

  const inP = spring({ frame: local, fps: BREACH_FPS, config: { damping: 16, mass: 0.8, stiffness: 120 } });
  const outP = progressBetween(local, total - 18, total);
  const opacity = clamp01(inP) * (1 - outP);
  const rise = interpolate(clamp01(inP), [0, 1], [26, 0]);

  // 6차: 키보드/사람 실루엣을 모두 없애고, 비워진 자리만큼 모니터 자체를
  // 크게 키워 화면이 훨씬 더 화면을 채우도록 함.
  const bezelW = 1680;
  const bezelH = 918;
  const bezelX = BREACH_WIDTH / 2 - bezelW / 2;
  const bezelY = 50;
  const screenPad = 36;
  const standH = 56;
  const baseH = 16;
  const standTop = bezelY + bezelH;
  const baseTop = standTop + standH;

  return (
    <AbsoluteFill style={{ opacity }}>
      <div style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, transform: `translateY(${rise}px)` }}>
        {/* 모니터 스탠드 */}
        <div
          style={{
            position: "absolute",
            left: BREACH_WIDTH / 2 - 21,
            top: standTop,
            width: 42,
            height: standH,
            background: "linear-gradient(180deg,#232530,#101116)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: BREACH_WIDTH / 2 - 130,
            top: baseTop,
            width: 260,
            height: baseH,
            borderRadius: 8,
            background: "linear-gradient(180deg,#26282f,#0d0e12)",
            boxShadow: "0 10px 22px rgba(0,0,0,0.5)",
          }}
        />

        {/* 모니터 베젤 */}
        <div
          style={{
            position: "absolute",
            left: bezelX,
            top: bezelY,
            width: bezelW,
            height: bezelH,
            borderRadius: 18,
            background: "linear-gradient(160deg,#1c1e26 0%, #101116 60%, #0a0b0e 100%)",
            boxShadow: `0 40px 90px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.03)`,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: screenPad,
              borderRadius: 8,
              background: "#FAFBFD",
              overflow: "hidden",
              boxShadow: `0 0 50px ${COLORS.was}1c, inset 0 0 24px rgba(20,24,34,0.05)`,
            }}
          >
            {/* 흰 화면이 밋밋하지 않도록 은은한 가로줄 텍스처 */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage: `repeating-linear-gradient(180deg, #E9EBF1 0px, #E9EBF1 1px, transparent 1px, transparent 40px)`,
                opacity: 0.6,
              }}
            />
            <ScreenDecor />
            <AppTopBar />
            <div
              style={{
                position: "absolute",
                top: 48,
                left: 0,
                right: 0,
                bottom: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {children}
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

// 스토리 전환 슬라이드 래퍼 - 화면이 옆으로 넘어가는 느낌
function StorySlide({ frame, startFrame, duration, children }) {
  const local = frame - startFrame;
  if (local < -10 || local > duration + 15) return null;

  const ENTER_DUR = 18;
  const OUT_START = duration - 22;
  const slideIn = spring({ frame: local, fps: BREACH_FPS, config: { damping: 20, mass: 0.7, stiffness: 170 } });
  const slideOutP = progressBetween(local, OUT_START, duration);
  const x =
    interpolate(clamp01(slideIn), [0, 1], [130, 0]) + interpolate(slideOutP, [0, 1], [0, -130]);
  const opacity = clamp01(slideIn) * (1 - slideOutP);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        opacity,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ transform: `translateX(${x}px)` }}>{children}</div>
    </div>
  );
}

// 모던 알림/메시지 카드 - 흰 화면 위에 뜨는 실시간 알림처럼 보이도록 구성
function MessageCard({ frame, startFrame, target, dwell, org }) {
  const local = frame - startFrame;
  if (local < 0) return null;

  const cardPop = spring({ frame: local, fps: BREACH_FPS, config: { damping: 16, mass: 0.75, stiffness: 150 } });
  const orgP = spring({ frame: local - 6, fps: BREACH_FPS, config: { damping: 15, mass: 0.6, stiffness: 150 } });
  const tagP = spring({ frame: local - 18, fps: BREACH_FPS, config: { damping: 14, mass: 0.55, stiffness: 160 } });
  // 카드 노출 시간을 195→150프레임(5초)으로 줄이면서, 마지막 줄(체류 기간)도
  // 그만큼 앞당겨서 슬라이드 아웃 전에 자리잡을 시간을 확보 (108 → 80).
  const dwellP = spring({ frame: local - 80, fps: BREACH_FPS, config: { damping: 14, mass: 0.55, stiffness: 160 } });

  // 카운트업 구간도 비례해서 단축 (36~94 → 26~66).
  const COUNT_START = 26;
  const COUNT_DUR = 40;
  const display = local >= COUNT_START ? useCountValue(frame, startFrame + COUNT_START, COUNT_DUR, target) : 0;
  const countP = spring({ frame: local - COUNT_START, fps: BREACH_FPS, config: { damping: 11, mass: 0.5, stiffness: 170 } });

  const dotPulse = 0.55 + 0.45 * Math.abs(Math.sin(frame * 0.12));

  return (
    <div
      style={{
        width: 960,
        background: "#FFFFFF",
        borderRadius: 28,
        border: "1px solid #E7E9EE",
        boxShadow: "0 28px 70px rgba(20,22,32,0.15)",
        padding: "52px 66px",
        opacity: clamp01(cardPop),
        transform: `translateY(${interpolate(clamp01(cardPop), [0, 1], [26, 0])}px) scale(${interpolate(
          clamp01(cardPop),
          [0, 1],
          [0.92, 1]
        )})`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: COLORS.critical,
            opacity: dotPulse,
            boxShadow: `0 0 ${8 * dotPulse}px ${COLORS.critical}`,
          }}
        />
        <span
          style={{
            fontFamily: SANS,
            fontSize: 14,
            fontWeight: 700,
            color: COLORS.critical,
            letterSpacing: 1.6,
          }}
        >
          실시간 탐지
        </span>
      </div>

      <div
        style={{
          marginTop: 20,
          fontFamily: SANS,
          fontSize: 42,
          fontWeight: 900,
          color: COLORS.ink,
          letterSpacing: -0.5,
          opacity: clamp01(orgP),
          transform: `translateY(${interpolate(clamp01(orgP), [0, 1], [10, 0])}px)`,
        }}
      >
        {org}
      </div>

      <div
        style={{
          marginTop: 16,
          opacity: clamp01(tagP),
          transform: `translateY(${interpolate(clamp01(tagP), [0, 1], [8, 0])}px)`,
        }}
      >
        <span
          style={{
            display: "inline-block",
            padding: "7px 20px",
            borderRadius: 999,
            background: "#FDEBEE",
            color: COLORS.critical,
            fontFamily: SANS,
            fontSize: 19,
            fontWeight: 600,
            letterSpacing: 0.2,
          }}
        >
          개인정보 유출
        </span>
      </div>

      <div style={{ marginTop: 26, borderTop: "1px solid #EEF0F4" }} />

      <div
        style={{
          marginTop: 26,
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          opacity: display > 0 ? 1 : 0,
          transform: `scale(${interpolate(clamp01(countP), [0, 1], [0.9, 1])})`,
        }}
      >
        <span
          style={{
            fontFamily: SANS,
            fontSize: 90,
            fontWeight: 800,
            color: COLORS.wasDeep,
            letterSpacing: -2,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {fmtCount(display)}
        </span>
        <span style={{ fontFamily: SANS, fontSize: 30, fontWeight: 700, color: COLORS.ink }}>건</span>
      </div>
      <div
        style={{
          marginTop: 6,
          fontFamily: SANS,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 0.8,
          textTransform: "uppercase",
          color: COLORS.inkGray,
        }}
      >
        유출된 개인정보 건수
      </div>

      <div style={{ marginTop: 28, borderTop: "1px solid #EEF0F4", paddingTop: 22 }} />

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "flex-start",
          gap: 14,
          opacity: clamp01(dwellP),
          transform: `translateY(${interpolate(clamp01(dwellP), [0, 1], [8, 0])}px)`,
        }}
      >
        <span
          style={{
            fontFamily: SANS,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 0.8,
            textTransform: "uppercase",
            color: COLORS.inkGray,
          }}
        >
          해커 잠입 기간
        </span>
        <span style={{ fontFamily: SANS, fontSize: 26, fontWeight: 800, color: COLORS.ink, letterSpacing: -0.3 }}>
          {dwell}
        </span>
      </div>
    </div>
  );
}

function MessageStory({ frame, startFrame, duration, org, target, dwell }) {
  const local = frame - startFrame;
  if (local < -15 || local > duration + 15) return null;

  return (
    <StorySlide frame={frame} startFrame={startFrame} duration={duration}>
      <MessageCard frame={frame} startFrame={startFrame} org={org} target={target} dwell={dwell} />
    </StorySlide>
  );
}

// =====================================================================
// 로그 비 + 개미굴처럼 방황하는 악성 로그
// =====================================================================
const RAIN_SAMPLES = [
  "GET /api/session 200",
  "WARN auth token expired",
  "INFO pod scaled up",
  "DEBUG cache miss key=42",
  "ERROR connection reset",
  "GET /users/1042 403",
  "WARN disk usage 81%",
  "INFO backup completed",
  "TRACE heartbeat ok",
  "ERROR 500 upstream",
  "INFO audit: role bound",
  "WARN retry attempt 3",
];
const RAIN_COLS = 42;
const ANT_COUNT = 9;

function rainX(i) {
  return (i / RAIN_COLS) * BREACH_WIDTH + (sr(i * 3.7) - 0.5) * 26;
}
function rainY(i, frame) {
  const speed = 5 + sr(i * 1.9 + 1) * 6;
  const startOffset = sr(i * 5.3 + 2) * 3000;
  return ((frame * speed + startOffset) % (BREACH_HEIGHT + 300)) - 150;
}
function antPos(i, t) {
  const seedA = sr(i * 3.1 + 1);
  const seedB = sr(i * 5.7 + 2);
  const seedPX = sr(i * 9.3 + 4);
  const seedPY = sr(i * 11.1 + 5);
  const freqA = 0.014 + seedA * 0.018;
  const freqB = 0.01 + seedB * 0.016;
  const Rx = 240 + seedA * 300;
  const Ry = 160 + seedB * 240;
  const cx = 340 + seedPX * (BREACH_WIDTH - 680);
  const cy = 280 + seedPY * (BREACH_HEIGHT - 520);
  const x = cx + Rx * Math.sin(t * freqA + seedPX * 12);
  const y = cy + Ry * Math.sin(t * freqB * 1.35 + seedPY * 12 + 1.6);
  return { x, y };
}

function RainLayer({ frame, opacity }) {
  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      {Array.from({ length: RAIN_COLS }).map((_, i) => {
        const x = rainX(i);
        const y = rainY(i, frame);
        const edgeFade = clamp01(Math.min(y / 90, (BREACH_HEIGHT - y) / 180));
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              fontFamily: MONO,
              fontSize: 13,
              color: COLORS.line,
              opacity: 0.55 * edgeFade,
              whiteSpace: "nowrap",
            }}
          >
            {RAIN_SAMPLES[i % RAIN_SAMPLES.length]}
          </div>
        );
      })}
    </div>
  );
}

function AntSwarm({ frame, opacity, connectTo }) {
  const ghostOffsets = [0, 4, 8, 12, 16];
  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${BREACH_WIDTH} ${BREACH_HEIGHT}`}
      style={{ position: "absolute", inset: 0, opacity }}
    >
      {connectTo &&
        Array.from({ length: ANT_COUNT }).map((_, i) => {
          const p = antPos(i, frame);
          return (
            <line
              key={`c${i}`}
              x1={p.x}
              y1={p.y}
              x2={connectTo.x}
              y2={connectTo.y}
              stroke={COLORS.mint}
              strokeWidth={1.5}
              opacity={connectTo.opacity * 0.55}
            />
          );
        })}
      {Array.from({ length: ANT_COUNT }).map((_, i) =>
        ghostOffsets.map((g, gi) => {
          const p = antPos(i, frame - g);
          const op = (1 - gi / ghostOffsets.length) * 0.9;
          const r = Math.max(1.5, 5 - gi * 0.6);
          return (
            <circle
              key={`${i}-${gi}`}
              cx={p.x}
              cy={p.y}
              r={r}
              fill={COLORS.critical}
              opacity={op}
              style={gi === 0 ? { filter: `drop-shadow(0 0 6px ${COLORS.critical})` } : undefined}
            />
          );
        })
      )}
    </svg>
  );
}

function ProblemScene({ frame, startFrame, duration }) {
  const local = frame - startFrame;
  if (local < -10 || local > duration + 10) return null;

  const sceneIn = progressBetween(local, 0, 20);
  const sceneOut = progressBetween(local, duration - 20, duration);
  const sceneOpacity = clamp01(sceneIn) * (1 - sceneOut);

  const textAppear = spring({ frame: local - 55, fps: BREACH_FPS, config: { damping: 15, mass: 0.6, stiffness: 130 } });

  return (
    <AbsoluteFill style={{ opacity: sceneOpacity }}>
      <RainLayer frame={frame} opacity={0.9} />
      <AntSwarm frame={frame} opacity={1} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: 140 }}>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 50,
            fontWeight: 700,
            color: COLORS.text,
            textAlign: "center",
            width: 1450,
            opacity: clamp01(textAppear),
            transform: `translateY(${interpolate(clamp01(textAppear), [0, 1], [16, 0])}px)`,
            textShadow: `0 4px 30px ${COLORS.bg}`,
          }}
        >
          쏟아지는 로그 속, <span style={{ color: COLORS.critical }}>위협은 조용히 숨어듭니다</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// =====================================================================
// 연관성 발견 장면
// =====================================================================
function MagnifierIcon({ size = 180, color, glow }) {
  const gid = "mag-grad";
  return (
    <svg width={size} height={size} viewBox="-70 -70 140 140" style={{ overflow: "visible" }}>
      <defs>
        <radialGradient id={gid} cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
          <stop offset="35%" stopColor={color} stopOpacity="0.55" />
          <stop offset="100%" stopColor={color} stopOpacity="0.05" />
        </radialGradient>
      </defs>
      <circle cx={-10} cy={-10} r={40} fill={`url(#${gid})`} />
      <circle
        cx={-10}
        cy={-10}
        r={36}
        fill="none"
        stroke={color}
        strokeWidth={9}
        style={glow ? { filter: `drop-shadow(0 0 18px ${color})` } : undefined}
      />
      <line
        x1={18}
        y1={18}
        x2={48}
        y2={48}
        stroke={color}
        strokeWidth={12}
        strokeLinecap="round"
        style={glow ? { filter: `drop-shadow(0 0 14px ${color})` } : undefined}
      />
    </svg>
  );
}

function CorrelationScene({ frame, startFrame, duration }) {
  const local = frame - startFrame;
  if (local < -10 || local > duration + 10) return null;

  const sceneIn = progressBetween(local, 0, 20);
  const sceneOut = progressBetween(local, duration - 20, duration);
  const sceneOpacity = clamp01(sceneIn) * (1 - sceneOut);

  const focusX = BREACH_WIDTH / 2;
  const focusY = BREACH_HEIGHT / 2 - 60;
  const connectOpacity = progressBetween(local, 10, 60);
  const rainFade = 1 - progressBetween(local, 0, 30);

  const magPop = spring({ frame: local, fps: BREACH_FPS, config: { damping: 14, mass: 0.6, stiffness: 130 } });
  const textAppear = spring({ frame: local - 40, fps: BREACH_FPS, config: { damping: 15, mass: 0.6, stiffness: 130 } });

  return (
    <AbsoluteFill style={{ opacity: sceneOpacity }}>
      <RainLayer frame={frame} opacity={0.35 * rainFade} />
      <AntSwarm frame={frame} opacity={1} connectTo={{ x: focusX, y: focusY, opacity: connectOpacity }} />

      <div
        style={{
          position: "absolute",
          left: focusX,
          top: focusY,
          transform: `translate(-50%, -50%) scale(${interpolate(clamp01(magPop), [0, 1], [0.6, 1])})`,
          opacity: clamp01(magPop),
        }}
      >
        <MagnifierIcon size={200} color={COLORS.mint} glow />
      </div>

      <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: 130 }}>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 44,
            fontWeight: 700,
            color: COLORS.text,
            textAlign: "center",
            width: 1400,
            lineHeight: 1.5,
            opacity: clamp01(textAppear),
            transform: `translateY(${interpolate(clamp01(textAppear), [0, 1], [16, 0])}px)`,
            textShadow: `0 4px 30px ${COLORS.bg}`,
          }}
        >
          흩어진 로그 속 이상 징후, <span style={{ color: COLORS.mint }}>그 연관성을 찾아내는 것</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// =====================================================================
// 결론: 레이더가 위협(빨간 블립)을 잡아내 방어(체크)로 이어지는 단일 내러티브
// =====================================================================
function CheckMark({ size = 44, color }) {
  return (
    <svg width={size} height={size} viewBox="-22 -22 44 44">
      <path
        d="M-12 1 L-3 11 L14 -9"
        fill="none"
        stroke={color}
        strokeWidth={6}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ filter: `drop-shadow(0 0 12px ${color})` }}
      />
    </svg>
  );
}

function RadarCaptureIcon({ size = 230, local }) {
  const color = COLORS.was;
  const gid = "radar-grad";
  const blipAngle = 132;
  const blipR = 52;
  const rad = (blipAngle * Math.PI) / 180;
  const bx = Math.cos(rad) * blipR;
  const by = Math.sin(rad) * blipR;

  const captureAt = 46;
  const captured = local >= captureAt;
  const captureP = spring({ frame: local - captureAt, fps: BREACH_FPS, config: { damping: 11, mass: 0.5, stiffness: 200 } });
  const burstP = progressBetween(local, captureAt, captureAt + 26);

  return (
    <svg width={size} height={size} viewBox="-100 -100 200 200" style={{ overflow: "visible" }}>
      <defs>
        <radialGradient id={gid} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.55" />
          <stop offset="30%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </radialGradient>
      </defs>
      <circle r={88} fill={`url(#${gid})`} />
      <circle r={88} fill="none" stroke={color} strokeWidth={3} opacity={0.32} />
      <circle r={60} fill="none" stroke={color} strokeWidth={3} opacity={0.46} />
      <circle r={30} fill="none" stroke={color} strokeWidth={3} opacity={0.6} />

      {!captured && (
        <circle cx={bx} cy={by} r={7} fill={COLORS.critical} style={{ filter: `drop-shadow(0 0 10px ${COLORS.critical})` }} />
      )}

      <g transform={`rotate(${(local * 6) % 360})`}>
        <path d="M0 0 L88 0 A88 88 0 0 1 57 66 Z" fill={color} opacity={0.3} />
        <line x1={0} y1={0} x2={88} y2={0} stroke={color} strokeWidth={4.5} style={{ filter: `drop-shadow(0 0 10px ${color})` }} />
      </g>

      <circle r={9} fill={color} style={{ filter: `drop-shadow(0 0 16px ${color})` }} />

      {captured && (
        <g transform={`translate(${bx * (1 - captureP)}, ${by * (1 - captureP)}) scale(${interpolate(clamp01(captureP), [0, 1], [1.4, 1])})`}>
          <circle r={20} fill={COLORS.bg} stroke={color} strokeWidth={3} opacity={clamp01(captureP)} />
          <g opacity={clamp01(captureP)}>
            <CheckMark size={30} color={color} />
          </g>
        </g>
      )}

      {burstP > 0 && burstP < 1 && (
        <circle
          r={interpolate(burstP, [0, 1], [10, 90])}
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          opacity={interpolate(burstP, [0, 1], [0.6, 0])}
        />
      )}
    </svg>
  );
}

function ConclusionScene({ frame, startFrame, duration }) {
  const local = frame - startFrame;
  if (local < -10 || local > duration + 10) return null;

  const sceneIn = progressBetween(local, 0, 20);
  const sceneOut = progressBetween(local, duration - 20, duration);
  const sceneOpacity = clamp01(sceneIn) * (1 - sceneOut);

  const iconPop = spring({ frame: local, fps: BREACH_FPS, config: { damping: 14, mass: 0.7, stiffness: 120 } });
  const introP = spring({ frame: local - 10, fps: BREACH_FPS, config: { damping: 15, mass: 0.6, stiffness: 130 } });
  // "우리가 주목하는 건"이 뜨고(local=10부터 스프링, 대략 35프레임쯤 자리잡음)
  // 바로 다음 줄이 이어지도록 40프레임으로 당김 (기존 92 → 40).
  const mainP = spring({ frame: local - 40, fps: BREACH_FPS, config: { damping: 14, mass: 0.6, stiffness: 130 } });

  return (
    <AbsoluteFill style={{ opacity: sceneOpacity, alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          opacity: clamp01(iconPop),
          transform: `scale(${interpolate(clamp01(iconPop), [0, 1], [0.7, 1])})`,
          marginBottom: 32,
        }}
      >
        {/* 결론 장면부터는 아이콘/텍스트를 한 단계 키움 (230 → 290) */}
        <RadarCaptureIcon size={290} local={local} />
      </div>

      <div
        style={{
          fontFamily: SANS,
          fontSize: 34,
          color: COLORS.textDim,
          opacity: clamp01(introP),
          transform: `translateY(${interpolate(clamp01(introP), [0, 1], [10, 0])}px)`,
        }}
      >
        우리가 주목하는 건
      </div>
      <div
        style={{
          marginTop: 14,
          fontFamily: SANS,
          fontSize: 58,
          fontWeight: 800,
          color: COLORS.was,
          textShadow: `0 0 30px ${COLORS.was}77`,
          opacity: clamp01(mainP),
          transform: `translateY(${interpolate(clamp01(mainP), [0, 1], [14, 0])}px)`,
        }}
      >
        빠르게 찾아 방어하는 것입니다.
      </div>
    </AbsoluteFill>
  );
}

// ---- 마지막 로고 리빌 (블루 계열 + 파동 링) ----
// 7차: 영상이 끝나기 직전, SENTINEL-OPS 워드마크가 커지면서 페이드아웃되고
// 그대로 영상이 종료되는 엔딩 연출 추가. endFrame(=BREACH_TOTAL_FRAMES)을
// 받아서 "끝까지 남은 프레임"을 계산해 OUT_DUR 구간 동안 확대+페이드.
function FinalReveal({ frame, startFrame, endFrame }) {
  const local = frame - startFrame;
  if (local < -10) return null;

  const logoPop = spring({ frame: local, fps: BREACH_FPS, config: { damping: 13, mass: 0.8, stiffness: 110 } });
  const taglineP = progressBetween(local, 26, 56);
  const ringCycle = 46;

  const OUT_DUR = 34;
  const outP = endFrame != null ? progressBetween(frame, endFrame - OUT_DUR, endFrame) : 0;
  const outScale = interpolate(outP, [0, 1], [1, 1.4]);
  const outOpacity = interpolate(outP, [0, 1], [1, 0]);

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: outOpacity }}>
      {local >= 0 &&
        [0, 15, 30].map((phase, i) => {
          const t = (local + phase) % ringCycle;
          const p = t / ringCycle;
          const r = interpolate(p, [0, 1], [30, 190]);
          const op = interpolate(p, [0, 1], [0.45, 0]);
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                width: r * 2,
                height: r * 2,
                borderRadius: "50%",
                border: `1.5px solid ${COLORS.was}`,
                opacity: clamp01(op) * clamp01(logoPop),
              }}
            />
          );
        })}
      <div
        style={{
          textAlign: "center",
          transform: `scale(${interpolate(clamp01(logoPop), [0, 1], [0.85, 1]) * outScale})`,
          opacity: clamp01(logoPop),
        }}
      >
        <div
          style={{
            fontFamily: MONO,
            fontSize: 88,
            fontWeight: 800,
            color: COLORS.was,
            letterSpacing: 6,
            textShadow: `0 0 46px ${COLORS.was}99`,
          }}
        >
          SENTINEL-OPS
        </div>
        <div
          style={{
            marginTop: 26,
            fontFamily: SANS,
            fontSize: 30,
            fontWeight: 500,
            color: COLORS.text,
            opacity: clamp01(taglineP) * (1 - outP),
            transform: `translateY(${interpolate(clamp01(taglineP), [0, 1], [12, 0])}px)`,
          }}
        >
          그래서, SENTINEL-OPS가 필요합니다
        </div>
      </div>
    </AbsoluteFill>
  );
}

export function BreachPatternIntro() {
  const frame = useCurrentFrame();

  // 7차 피드백: 카드 4개 합쳐서 총 25초가량 나오는데(카드 하나당 6.5초),
  // 이걸 20초로 줄여달라 - 카드당 150프레임(5초)으로, 뒤이어 CARD_STARTS도
  // 150프레임 간격으로 다시 이어붙임.
  const CARD_DURATION = 150;
  const CARD_STARTS = [10, 160, 310, 460];
  const SHELL_START = CARD_STARTS[0] - 15;
  const SHELL_END = CARD_STARTS[3] + CARD_DURATION + 15;

  const PROBLEM_START = SHELL_END + 15;
  const PROBLEM_DURATION = 150;
  const CORR_START = PROBLEM_START + PROBLEM_DURATION;
  const CORR_DURATION = 100;
  const CONCLUSION_START = CORR_START + CORR_DURATION;
  // mainP를 40프레임으로 당겨서 "우리가 주목하는 건" 바로 다음에 이어지게
  // 했고(≈65프레임쯤 자리잡음), 문구가 다 뜬 뒤 페이드아웃 전 1초 정도
  // 붙잡아두는 것도 유지 - duration을 그만큼 줄임(160 → 115).
  const CONCLUSION_DURATION = 115;
  const FINAL_START = CONCLUSION_START + CONCLUSION_DURATION;

  const globalFade = progressBetween(frame, 0, 15);

  const stories = [
    { org: "국내 대형 통신사", target: 27000000, dwell: "약 3년" },
    { org: "글로벌 호텔 그룹", target: 500000000, dwell: "약 4년" },
    { org: "미국 대형 신용평가사", target: 147000000, dwell: "약 4개월" },
    { org: "미국 대형 인터넷 기업", target: 3000000000, dwell: "2년 이상" },
  ];

  return (
    <AbsoluteFill style={{ opacity: globalFade }}>
      <CyberBackground frame={frame} />

      <MonitorShell frame={frame} startFrame={SHELL_START} endFrame={SHELL_END}>
        {stories.map((s, i) => (
          <MessageStory
            key={s.org}
            frame={frame}
            startFrame={CARD_STARTS[i]}
            duration={CARD_DURATION}
            org={s.org}
            target={s.target}
            dwell={s.dwell}
          />
        ))}
      </MonitorShell>

      <ProblemScene frame={frame} startFrame={PROBLEM_START} duration={PROBLEM_DURATION} />
      <CorrelationScene frame={frame} startFrame={CORR_START} duration={CORR_DURATION} />
      <ConclusionScene frame={frame} startFrame={CONCLUSION_START} duration={CONCLUSION_DURATION} />
      <FinalReveal frame={frame} startFrame={FINAL_START} endFrame={BREACH_TOTAL_FRAMES} />
    </AbsoluteFill>
  );
}
