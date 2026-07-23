import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";

// ---- 컴포지션 기본값 ----
// DualMonitorTour.jsx의 "변형" 버전 - 구간마다 바뀌던 eyebrow/headline 텍스트를
// 전부 없애고, 상단에 "SENTINEL-OPS" 로고 텍스트 하나만 영상 내내 고정으로
// 띄운 채 모니터 화면들만 계속 바뀌도록 만든다. 기존 DualMonitorTour는
// 로그인 온보딩용으로 그대로 쓰고 있어 건드리지 않고 별개 컴포지션으로 둔다.
export const BRAND_FPS = 30;
export const BRAND_WIDTH = 2560;
export const BRAND_HEIGHT = 1440;
const SCALE = BRAND_WIDTH / 1280;

const HOLD = 85; // ~2.83s 정지
const TRANS = 26; // ~0.87s 스크롤 전환
const STEP = HOLD + TRANS;

// 화면 순서는 DualMonitorTour와 동일 - public/의 실제 파일명을 그대로 참조.
const SECTIONS = [
  {
    key: "overview",
    monitors: [
      { theme: "dark", file: "overview black.png" },
      { theme: "light", file: "overview white.png" },
    ],
  },
  {
    key: "incident",
    monitors: [
      { theme: "dark", file: "incident black.png" },
      { theme: "light", file: "incident white.png" },
    ],
  },
  {
    key: "attack",
    monitors: [
      { theme: "dark", file: "ATT&CK black.png" },
      { theme: "light", file: "ATT&CK white.png" },
    ],
  },
  {
    key: "infra",
    monitors: [
      { theme: "dark", file: "infrasturcture black.png" },
      { theme: "light", file: "infrastructure white.png" },
    ],
  },
  {
    key: "custom",
    monitors: [
      { theme: "dark", file: "change black.png" },
      { theme: "light", file: "change white.png" },
    ],
  },
];

const SECTION_COUNT = SECTIONS.length;
export const BRAND_TOTAL_FRAMES = STEP * (SECTION_COUNT - 1) + HOLD;

const SECTION_START = SECTIONS.map((_, i) => i * STEP);

const SCROLL_INPUT = [];
const SCROLL_OUTPUT = [];
SECTIONS.forEach((_, i) => {
  const start = i * STEP;
  SCROLL_INPUT.push(start, start + HOLD);
  SCROLL_OUTPUT.push(i * BRAND_HEIGHT, i * BRAND_HEIGHT);
});

function useScrollY(frame) {
  return interpolate(frame, SCROLL_INPUT, SCROLL_OUTPUT, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
function progressBetween(frame, start, end) {
  if (end <= start) return frame >= end ? 1 : 0;
  return interpolate(frame, [start, end], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
}

function Backdrop() {
  return (
    <AbsoluteFill style={{ backgroundColor: "#0d0e13" }}>
      <AbsoluteFill
        style={{
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)",
          backgroundSize: `${34 * SCALE}px ${34 * SCALE}px`,
          opacity: 0.5,
        }}
      />
      <AbsoluteFill
        style={{ background: "radial-gradient(ellipse at 50% 15%, rgba(255,255,255,0.06) 0%, transparent 60%)" }}
      />
    </AbsoluteFill>
  );
}

function Monitor({ theme, width, height, children }) {
  const isDark = theme === "dark";
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 16 * SCALE,
        padding: 10 * SCALE,
        background: "#1b1d24",
        boxShadow: "0 24px 60px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.06)",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 8 * SCALE,
          overflow: "hidden",
          background: isDark ? "#000" : "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ---- 구간 하나 - 캡션 없이 모니터 1~2대만, 화면 중앙에 배치 ----
function Section({ section, index, frame }) {
  const startFrame = SECTION_START[index];
  const enter = spring({
    frame: frame - startFrame,
    fps: BRAND_FPS,
    config: { damping: 16, mass: 0.6, stiffness: 120 },
  });
  const monitorScale = interpolate(enter, [0, 1], [0.92, 1], { extrapolateRight: "clamp" });
  const monitorSize = { w: 602 * SCALE, h: 392 * SCALE };

  return (
    <div
      style={{
        width: BRAND_WIDTH,
        height: BRAND_HEIGHT,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ transform: `scale(${monitorScale})`, display: "flex", gap: 40 * SCALE }}>
        {section.monitors.map((m) => (
          <Monitor key={m.theme} theme={m.theme} width={monitorSize.w} height={monitorSize.h}>
            <Img src={staticFile(m.file)} style={{ width: "100%", height: "100%", objectFit: "contain" }} from={-2} />
          </Monitor>
        ))}
      </div>
    </div>
  );
}

// ---- 상단 고정 브랜드 표기 - "SENTINEL-OPS" 하나만, 영상 내내 유지 ----
function BrandHeader({ frame }) {
  const introP = progressBetween(frame, 0, 22);
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 74 * SCALE, opacity: clamp01(introP) }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 * SCALE }}>
        <div
          style={{
            width: 36 * SCALE,
            height: 36 * SCALE,
            borderRadius: 11 * SCALE,
            background: "rgba(127,216,200,0.14)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 26px rgba(127,216,200,0.35)",
          }}
        >
          <div style={{ width: 15 * SCALE, height: 15 * SCALE, borderRadius: 4 * SCALE, border: "2.5px solid #7fd8c8" }} />
        </div>
        <div
          style={{
            color: "#fff",
            fontSize: 36 * SCALE,
            fontWeight: 800,
            letterSpacing: 2 * SCALE,
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
            textShadow: "0 0 30px rgba(127,216,200,0.35)",
          }}
        >
          SENTINEL-OPS
        </div>
      </div>
    </AbsoluteFill>
  );
}

// ---- 하단 진행 점 5개 ----
function ProgressDots({ frame }) {
  const scrollY = useScrollY(frame);
  const activeFloat = scrollY / BRAND_HEIGHT;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 26 * SCALE }}>
      <div style={{ display: "flex", gap: 10 * SCALE }}>
        {SECTIONS.map((s, i) => {
          const dist = Math.abs(activeFloat - i);
          const active = dist < 0.5;
          return (
            <div
              key={s.key}
              style={{
                width: active ? 22 * SCALE : 8 * SCALE,
                height: 8 * SCALE,
                borderRadius: 4 * SCALE,
                background: active ? "#7fd8c8" : "rgba(255,255,255,0.25)",
              }}
            />
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

export function DualMonitorTourBrand() {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const scrollY = useScrollY(frame);

  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <div
          style={{
            width,
            height: height * SECTION_COUNT,
            transform: `translateY(${-scrollY}px)`,
          }}
        >
          {SECTIONS.map((section, i) => (
            <Section key={section.key} section={section} index={i} frame={frame} />
          ))}
        </div>
      </AbsoluteFill>
      <BrandHeader frame={frame} />
      <ProgressDots frame={frame} />
    </AbsoluteFill>
  );
}
