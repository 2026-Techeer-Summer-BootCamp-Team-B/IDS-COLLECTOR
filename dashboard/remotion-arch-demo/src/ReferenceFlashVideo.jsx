import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame } from "remotion";

// ---- 영상 스펙 ----
// "이런 사이트들을 참고해서 만들었다" - public/ 폴더에 이미 있는 참고 자료
// 스크린샷 10장(MITRE ATT&CK, Kubernetes 보안 자료 등)을 글씨 없이 빠르게
// 넘겨 보여주는 아주 짧은 몽타주 클립. 텍스트 오버레이 전혀 없음.
export const REF_FPS = 30;
export const REF_WIDTH = 1920;
export const REF_HEIGHT = 1080;
export const FRAMES_PER_IMAGE = 11; // 0.37초씩 - "후다다닥" 넘어가는 속도
export const REF_TAIL_FRAMES = 10;

const IMAGE_FILES = [
  "image.png",
  "image copy.png",
  "image copy 0.png",
  "image copy 1.png",
  "image copy 2.png",
  "image copy 3.png",
  "image copy 4.png",
  "image copy 5.png",
  "image copy 6.png",
  "image copy 7.png",
];

export const REF_TOTAL_FRAMES = IMAGE_FILES.length * FRAMES_PER_IMAGE + REF_TAIL_FRAMES;

const COLORS = {
  bg: "#020203",
  mint: "#00FFA6",
  cyan: "#3FD9FF",
  line: "#4A5170",
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

function progressBetween(frame, start, end) {
  if (end <= start) return frame >= end ? 1 : 0;
  return interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

function FlashBackground({ frame }) {
  const blobs = [
    { cx: 0.22, cy: 0.25, r: 420, color: COLORS.mint, fx: 0.002, fy: 0.0016, ph: 0 },
    { cx: 0.8, cy: 0.78, r: 420, color: COLORS.cyan, fx: 0.0018, fy: 0.0021, ph: 2.1 },
  ];
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(circle, ${COLORS.line}22 1px, transparent 1px)`,
          backgroundSize: "50px 50px",
          opacity: 0.22,
        }}
      />
      {blobs.map((b, i) => {
        const x = (b.cx + Math.sin(frame * b.fx + b.ph) * 0.02) * REF_WIDTH;
        const y = (b.cy + Math.cos(frame * b.fy + b.ph) * 0.02) * REF_HEIGHT;
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

export function ReferenceFlashVideo() {
  const frame = useCurrentFrame();

  const idx = Math.min(IMAGE_FILES.length - 1, Math.floor(frame / FRAMES_PER_IMAGE));
  const local = frame - idx * FRAMES_PER_IMAGE;

  const pop = spring({ frame: local, fps: REF_FPS, config: { damping: 14, stiffness: 260, mass: 0.4 } });
  const scale = interpolate(pop, [0, 1], [1.06, 1]);
  const flash = clamp01(1 - local / 3); // 전환 순간 아주 짧은 흰 섬광

  const introP = progressBetween(frame, 0, 4);
  const tailStart = REF_TOTAL_FRAMES - REF_TAIL_FRAMES;
  const blackoutP = progressBetween(frame, tailStart, REF_TOTAL_FRAMES);

  const progressFrac = clamp01((idx + clamp01(local / FRAMES_PER_IMAGE)) / IMAGE_FILES.length);

  return (
    <AbsoluteFill>
      <FlashBackground frame={frame} />

      <AbsoluteFill style={{ opacity: clamp01(introP), alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            width: 1680,
            height: 900,
            borderRadius: 24,
            border: `2px solid ${COLORS.mint}55`,
            boxShadow: `0 0 60px ${COLORS.mint}22`,
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#0A0A0D",
            transform: `scale(${scale})`,
          }}
        >
          <Img
            src={staticFile(IMAGE_FILES[idx])}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        </div>

        {/* 전환 섬광 */}
        <AbsoluteFill style={{ backgroundColor: "#FFFFFF", opacity: flash * 0.12, pointerEvents: "none" }} />

        {/* 진행 바 - 텍스트 없이 얇은 라인만 */}
        <div style={{ position: "absolute", left: 120, right: 120, bottom: 64, height: 3, backgroundColor: `${COLORS.line}55`, borderRadius: 2 }}>
          <div
            style={{
              width: `${progressFrac * 100}%`,
              height: "100%",
              backgroundColor: COLORS.mint,
              borderRadius: 2,
              boxShadow: `0 0 10px ${COLORS.mint}`,
            }}
          />
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{ backgroundColor: "#000000", opacity: blackoutP }} />
    </AbsoluteFill>
  );
}
