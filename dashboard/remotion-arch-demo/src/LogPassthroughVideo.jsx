import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

// ---- 영상 스펙 ----
// "계층별로 로그들이 쏟아지면서 하나로 합쳐지는게 아니라 빨간색 로그들이
// 그대로 지나가는" 영상. 네 개의 수직선을 따라 원들이 위에서 아래로 계속
// 떨어지다가, 화면 중앙의 병합 라인에 닿으면 파란 원은 흡수되듯 사라지고
// 빨간 원만 라인을 무시하고 원본 그대로 끝까지 통과한다. 텍스트/라벨 전부
// 제거 - 색과 움직임만으로 전달하는 순수 비주얼 클립.
export const RAIN_FPS = 30;
export const RAIN_WIDTH = 1920;
export const RAIN_HEIGHT = 1080;
export const RAIN_TOTAL_FRAMES = 350; // 약 11.7초

const COLORS = {
  bg: "#020203",
  blue: "#3B82F6",
  critical: "#FF3B4E",
  line: "#4A5170",
  mint: "#00FFA6",
};

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

const LANE_COUNT = 4;
const DOTS_PER_LANE = 6;
const MERGE_Y = RAIN_HEIGHT / 2;
const FALL_RANGE = RAIN_HEIGHT + 240;
const LANE_WIDTH = RAIN_WIDTH / LANE_COUNT;
const DOT_SIZE = 64; // "큰 원"

// 레인/원 배치는 프레임과 무관하게 시드로 고정 - 매번 같은 모양으로 재현.
// 가로 흔들림(jitter) 없이 각 레인 중앙을 그대로 타고 내려와 "네 개의 줄"
// 처럼 보이게 한다.
const DOTS = Array.from({ length: LANE_COUNT }).flatMap((_, laneIdx) =>
  Array.from({ length: DOTS_PER_LANE }).map((_, dotIdx) => {
    const seed = laneIdx * 97 + dotIdx * 13.7;
    return {
      laneIdx,
      speed: 2.6 + sr(seed) * 2.4,
      phase: sr(seed + 3) * FALL_RANGE,
      isRed: sr(seed + 7) < 0.28,
    };
  })
);

function dotOpacity(y, isRed) {
  const fadeIn = clamp01(interpolate(y, [-120, -40], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  if (isRed) return fadeIn;
  const fadeAtLine = clamp01(
    interpolate(y, [MERGE_Y - 70, MERGE_Y + 6], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  );
  return fadeIn * fadeAtLine;
}

// =====================================================================
// 배경
// =====================================================================
function RainBackground({ frame }) {
  const blobs = [
    { cx: 0.2, cy: 0.3, r: 420, color: COLORS.blue, fx: 0.0012, fy: 0.001, ph: 0 },
    { cx: 0.8, cy: 0.7, r: 420, color: COLORS.critical, fx: 0.0014, fy: 0.0011, ph: 2.4 },
  ];
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(circle, ${COLORS.line}22 1px, transparent 1px)`,
          backgroundSize: "50px 50px",
          opacity: 0.25,
        }}
      />
      {blobs.map((b, i) => {
        const x = (b.cx + Math.sin(frame * b.fx + b.ph) * 0.02) * RAIN_WIDTH;
        const y = (b.cy + Math.cos(frame * b.fy + b.ph) * 0.02) * RAIN_HEIGHT;
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
              background: `radial-gradient(circle, ${b.color}10 0%, ${b.color}00 70%)`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
}

function LogDot({ dot, frame }) {
  const y = ((frame * dot.speed + dot.phase) % FALL_RANGE) - 120;
  const opacity = dotOpacity(y, dot.isRed);
  if (opacity <= 0.01) return null;

  const x = dot.laneIdx * LANE_WIDTH + LANE_WIDTH / 2;
  const color = dot.isRed ? COLORS.critical : COLORS.blue;

  return (
    <div
      style={{
        position: "absolute",
        left: x - DOT_SIZE / 2,
        top: y,
        width: DOT_SIZE,
        height: DOT_SIZE,
        borderRadius: "50%",
        opacity,
        background: color,
        boxShadow: `0 0 ${dot.isRed ? 30 : 20}px ${color}, 0 0 ${dot.isRed ? 60 : 36}px ${color}66`,
      }}
    />
  );
}

// =====================================================================
// 메인 컴포지션
// =====================================================================
export function LogPassthroughVideo() {
  const frame = useCurrentFrame();

  const introP = progressBetween(frame, 0, 18);
  const lineGlow = 0.55 + 0.45 * Math.sin(frame * 0.07);
  const blackoutP = progressBetween(frame, RAIN_TOTAL_FRAMES - 15, RAIN_TOTAL_FRAMES);

  return (
    <AbsoluteFill>
      <RainBackground frame={frame} />

      <AbsoluteFill style={{ opacity: clamp01(introP) }}>
        {/* 병합 라인 - 파란 원은 여기서 사라진다 */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: MERGE_Y,
            height: 2,
            background: COLORS.mint,
            opacity: 0.25 + lineGlow * 0.35,
            boxShadow: `0 0 ${14 + lineGlow * 10}px ${COLORS.mint}`,
          }}
        />

        {/* 네 개의 줄을 타고 내려오는 원들 */}
        {DOTS.map((dot, i) => (
          <LogDot key={i} dot={dot} frame={frame} />
        ))}
      </AbsoluteFill>

      <AbsoluteFill style={{ backgroundColor: "#000000", opacity: blackoutP }} />
    </AbsoluteFill>
  );
}
