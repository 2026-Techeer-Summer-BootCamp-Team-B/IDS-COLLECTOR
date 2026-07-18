import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";

// ---- 컴포지션 기본값 ----
// 2026-07-17: 모니터 안 스크린샷이 흐릿해 보인다는 피드백 - 1920x1080으로
// 한 번 올렸는데도 아직 흐리다고 해서 2560x1440(SCALE=2)까지 다시 올렸다.
// 이게 사실상의 상한선이다 - public/의 스크린샷 원본 중 가장 작은 게
// "ATT&CK white.png"(1655x756)인데, 이 배율에서 모니터 안쪽 실제 표시 영역이
// 대략 1164x744로 여전히 그보다 작아서(다운스케일) 업스케일에 의한 흐림이
// 안 생긴다. 여기서 더 올리면(예: 4K/SCALE=3) 모니터 표시 영역이 이 원본보다
// 커져서 오히려 업스케일 때문에 더 흐려진다 - 근본적으로 더 선명하게 하려면
// public/ 스크린샷 자체를 더 고해상도로 다시 찍어야 한다.
// 기존 OnboardingDemo(로그인 화면용)와는 별개 컴포지션이라 그쪽 해상도는 그대로.
export const FPS = 30;
export const WIDTH = 2560;
export const HEIGHT = 1440;
// 아래 레이아웃 수치들은 전부 1280 기준으로 잡았던 걸 이 배율로 일괄 확대한다 -
// 나중에 WIDTH를 또 바꾸면 SCALE만 따라 바뀌므로 숫자를 일일이 다시 잡을 필요 없음.
const SCALE = WIDTH / 1280;

// ---- 한 구간(화면 소개)당 정지 시간 / 다음 구간으로 스크롤되는 시간 ----
const HOLD = 85; // ~2.83s 정지
const TRANS = 26; // ~0.87s 스크롤 전환
const STEP = HOLD + TRANS;

// 화면 순서: Overview -> Incident -> ATT&CK -> Infrastructure -> Custom(마무리).
// public/의 실제 파일명을 그대로 참조한다(공백/& 포함, "infrasturcture black.png"는
// 원본 파일명 자체의 오타라 그대로 씀 - 대소문자/철자 하나라도 다르면 로드 실패).
const SECTIONS = [
  {
    key: "overview",
    eyebrow: "OVERVIEW",
    headline: "한눈에 보이는 화면",
    monitors: [
      { theme: "dark", file: "overview black.png" },
      { theme: "light", file: "overview white.png" },
    ],
  },
  {
    key: "incident",
    eyebrow: "INCIDENT RESPONSE",
    headline: "실시간으로 감지되는 공격들",
    monitors: [
      { theme: "dark", file: "incident black.png" },
      { theme: "light", file: "incident white.png" },
    ],
  },
  {
    key: "attack",
    eyebrow: "MITRE ATT&CK",
    headline: "내장된 MITRE ATT&CK 표준 기법",
    monitors: [
      { theme: "dark", file: "ATT&CK black.png" },
      { theme: "light", file: "ATT&CK white.png" },
    ],
  },
  {
    key: "infra",
    eyebrow: "INFRASTRUCTURE",
    headline: "로그의 상태와 발원지를 쉽게 확인",
    monitors: [
      { theme: "dark", file: "infrasturcture black.png" },
      { theme: "light", file: "infrastructure white.png" },
    ],
  },
  {
    key: "custom",
    eyebrow: "CUSTOMIZATION",
    headline: "커스텀 기능까지 갖춘 사용자 맞춤 대시보드",
    monitors: [
      { theme: "dark", file: "change black.png" },
      { theme: "light", file: "change white.png" },
    ],
  },
];

const SECTION_COUNT = SECTIONS.length;
export const TOTAL_FRAMES = STEP * (SECTION_COUNT - 1) + HOLD;

// 각 구간의 시작 프레임(스크롤 전환이 끝나고 정지가 시작되는 지점).
const SECTION_START = SECTIONS.map((_, i) => i * STEP);

// scrollY(frame): 정지 -> 스크롤 -> 정지 -> 스크롤 ... 패턴의 키프레임 배열을
// 한 번에 만들어 interpolate 하나로 처리(구간마다 if문 쌓는 것보다 안전).
const SCROLL_INPUT = [];
const SCROLL_OUTPUT = [];
SECTIONS.forEach((_, i) => {
  const start = i * STEP;
  SCROLL_INPUT.push(start, start + HOLD);
  SCROLL_OUTPUT.push(i * HEIGHT, i * HEIGHT);
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

// ---- 배경: 두 테마(블랙/화이트) 모니터가 공통으로 놓일 중립적인 다크 배경 ----
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

// ---- 모니터 한 대 (네모난 베젤 + 화면만, 받침대 없음), CSS 도형만 사용 ----
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

// ---- 구간 하나: 상단 캡션(eyebrow + 헤드라인) + 모니터 1~2대 ----
function Section({ section, index, frame }) {
  const startFrame = SECTION_START[index];
  // 이 구간으로 스크롤이 들어오는 타이밍에 맞춰 살짝 확대되며 settle-in.
  const enter = spring({
    frame: frame - startFrame,
    fps: FPS,
    config: { damping: 16, mass: 0.6, stiffness: 120 },
  });
  const monitorScale = interpolate(enter, [0, 1], [0.92, 1], { extrapolateRight: "clamp" });
  const captionSlide = interpolate(clamp01(enter), [0, 1], [16 * SCALE, 0]);
  const captionOpacity = progressBetween(frame, startFrame, startFrame + 18);

  // 2026-07-17: 블랙/화이트 화면이 너무 작다는 피드백 - 기존 430x280에서
  // 1.4배(602x392, 1280 기준)로 키웠고, 그 뒤 해상도를 1920x1080으로 올리면서
  // 같은 배율(SCALE)을 곱해 상대적인 크기는 그대로 유지한다.
  const monitorSize = { w: 602 * SCALE, h: 392 * SCALE };

  return (
    <div
      style={{
        width: WIDTH,
        height: HEIGHT,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          textAlign: "center",
          marginBottom: 42 * SCALE,
          opacity: captionOpacity,
          transform: `translateY(${captionSlide}px)`,
        }}
      >
        <div
          style={{
            color: "#7fd8c8",
            fontSize: 15 * SCALE,
            fontWeight: 700,
            letterSpacing: 4 * SCALE,
            marginBottom: 8 * SCALE,
            fontFamily: "'SF Mono', 'Menlo', monospace",
          }}
        >
          {section.eyebrow}
        </div>
        <div
          style={{
            color: "#fff",
            fontSize: 38 * SCALE,
            fontWeight: 800,
            letterSpacing: -0.5,
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
          }}
        >
          {section.headline}
        </div>
      </div>
      <div style={{ transform: `scale(${monitorScale})`, display: "flex", gap: 40 * SCALE }}>
        {section.monitors.map((m) => (
          <Monitor key={m.theme} theme={m.theme} width={monitorSize.w} height={monitorSize.h}>
            <Img
              src={staticFile(m.file)}
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
              from={-2} />
          </Monitor>
        ))}
      </div>
    </div>
  );
}

// ---- 하단 진행 점 5개 - 지금 어느 구간인지 표시 ----
function ProgressDots({ frame }) {
  const scrollY = useScrollY(frame);
  const activeFloat = scrollY / HEIGHT;
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
                transition: "none",
              }}
            />
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

export function DualMonitorTour() {
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
      <ProgressDots frame={frame} />
    </AbsoluteFill>
  );
}
