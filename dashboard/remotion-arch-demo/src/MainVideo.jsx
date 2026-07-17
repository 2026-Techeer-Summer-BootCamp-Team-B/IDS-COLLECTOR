import React from "react";
import { AbsoluteFill, interpolate, interpolateColors, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

// ---- 영상 스펙 ----
export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const TOTAL_FRAMES = 570; // 19초 (기존 15초 + 대시보드 리빌용 4초 연장)

// ---- 컬러 팔레트 ----
// dashboard/src/data/theme.js의 dark 테마 값을 그대로 가져와서 실제 대시보드와
// 톤을 맞췄다 (기존 남색 틴트가 섞인 사이버펑크 팔레트 대신 "찐한 블랙" 위주).
const COLORS = {
  bg: "#030305", // dashboard dark.bg
  bgDeep: "#0D0D10", // dashboard dark.surface
  bgAlt: "#16161B", // dashboard dark.surfaceAlt
  safe: "#2f9bff",
  danger: "#FF1F4B", // dashboard dark.critical
  line: "#5A6288", // dashboard dark.faint
  text: "#F2F5FF", // dashboard dark.fg
  textDim: "#8890B5", // dashboard dark.muted
};

const SETTLE_DELAY = 20; // 병합점 도착 -> 수집함 슬롯에 완전히 안착하기까지 걸리는 프레임 수

// ---- Act 1: 트리 노드 좌표 (상단 1/3) ----
const NODE = {
  external: { x: 960, y: 90 },
  ingress: { x: 960, y: 220 },
  was1: { x: 580, y: 380 },
  was2: { x: 960, y: 380 },
  was3: { x: 1340, y: 380 },
};

// ---- Act 2: 4개 로그 계층 레인 + 상관분석 병합점 ----
// 좌우 끝(WAS/K8S)이 프레임 밖으로 잘리는 문제 수정: 가로 폭을 좁혀서
// 양쪽 여백을 420px씩 확보 (기존 300px -> 420px).
const LANES = [
  { key: "was", label: "WAS", x: 420 },
  { key: "waf", label: "WAF", x: 780 },
  { key: "falco", label: "FALCO", x: 1140 },
  { key: "k8s", label: "K8S AUDIT", x: 1500 },
];
const LANE_LABEL_Y = 500;
const LANE_TOP_Y = 545;
const LANE_BOTTOM_Y = 780;
const MERGE_POINT = { x: 960, y: 780 };
const BOX = { x: 830, y: 820, w: 260, h: 130 };
const BOX_SLOTS = [
  { x: 900, y: 860 },
  { x: 1020, y: 860 },
  { x: 900, y: 920 },
  { x: 1020, y: 920 },
];

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// 두 프레임 구간 사이의 진행도(0~1) - extrapolate는 항상 clamp로 고정해서
// 구간을 벗어나도 값이 튀지 않게 한다.
function progressBetween(frame, start, end) {
  if (end <= start) return frame >= end ? 1 : 0;
  return interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

// ---- 배경: 어두운 그라디언트 + 점 격자 패턴(전부 CSS, 이미지 없음) ----
function CyberBackground({ frame }) {
  const fadeIn = progressBetween(frame, 0, 30);
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg, opacity: interpolate(fadeIn, [0, 1], [0, 1]) }}>
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(circle, ${COLORS.line}33 1px, transparent 1px)`,
          backgroundSize: "48px 48px",
          opacity: 0.5,
        }}
      />
      <AbsoluteFill
        style={{ background: `radial-gradient(ellipse at 50% 30%, ${COLORS.bg}00 0%, ${COLORS.bgDeep} 78%)` }}
      />
    </AbsoluteFill>
  );
}

// ---- 브랜드 마크 (좌상단, 작게 상시 노출) ----
function BrandMark({ frame }) {
  const p = progressBetween(frame, 4, 34);
  return (
    <div
      style={{
        position: "absolute",
        top: 40,
        left: 56,
        opacity: p,
        transform: `translateY(${interpolate(p, [0, 1], [-10, 0])}px)`,
        fontFamily: "'SF Mono', 'Menlo', monospace",
      }}
    >
      <div style={{ color: COLORS.safe, fontSize: 18, fontWeight: 700, letterSpacing: 4 }}>SENTINEL-OPS</div>
      <div style={{ color: COLORS.textDim, fontSize: 12, letterSpacing: 2, marginTop: 3 }}>
        REAL-TIME THREAT TRACE
      </div>
    </div>
  );
}

// ---- Act 1: 트리 노드 (원, CSS 도형만) ----
function TreeNode({ frame, at, size = 92, label, sublabel, appearFrame }) {
  const pop = spring({ frame: frame - appearFrame, fps: FPS, config: { damping: 14, mass: 0.6, stiffness: 130 } });
  const opacity = clamp01(pop);
  const scale = interpolate(pop, [0, 1], [0.4, 1], { extrapolateRight: "clamp" });

  return (
    <div
      style={{
        position: "absolute",
        left: at.x - size / 2,
        top: at.y - size / 2,
        width: size,
        height: size,
        opacity,
        transform: `scale(${scale})`,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: "50%",
          border: `2px solid ${COLORS.safe}`,
          backgroundColor: `${COLORS.safe}14`,
          boxShadow: `0 0 18px ${COLORS.safe}99, inset 0 0 18px ${COLORS.safe}22`,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "100%",
          left: "50%",
          transform: "translateX(-50%)",
          marginTop: 12,
          textAlign: "center",
          whiteSpace: "nowrap",
          fontFamily: "'SF Mono', 'Menlo', monospace",
        }}
      >
        <div style={{ color: COLORS.text, fontWeight: 700, fontSize: 18, letterSpacing: 1 }}>{label}</div>
        {sublabel && <div style={{ color: COLORS.textDim, fontSize: 12, marginTop: 2 }}>{sublabel}</div>}
      </div>
    </div>
  );
}

// ---- Act 1: 트리 엣지 (SVG stroke-dashoffset으로 그려지는 효과) ----
function TreeEdge({ from, to, drawStart, drawEnd, frame }) {
  const progress = progressBetween(frame, drawStart, drawEnd);
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  return (
    <line
      x1={from.x}
      y1={from.y}
      x2={to.x}
      y2={to.y}
      stroke={COLORS.line}
      strokeWidth={2}
      strokeDasharray={length}
      strokeDashoffset={length * (1 - progress)}
      opacity={0.85}
    />
  );
}

function TravelingDot({ from, to, activeFrom, loopLength, frame, phaseOffset = 0 }) {
  if (frame < activeFrom) return null;
  const local = (frame - activeFrom + phaseOffset) % loopLength;
  const t = local / loopLength;
  const fade = Math.sin(Math.PI * t);
  const x = interpolate(t, [0, 1], [from.x, to.x]);
  const y = interpolate(t, [0, 1], [from.y, to.y]);
  return (
    <circle
      cx={x}
      cy={y}
      r={5}
      fill={COLORS.safe}
      opacity={clamp01(fade) * 0.9}
      style={{ filter: `drop-shadow(0 0 6px ${COLORS.safe})` }}
    />
  );
}

// ---- Act 1 -> Act 2 를 잇는 브릿지 라인 ----
function Bridge({ frame }) {
  const progress = progressBetween(frame, 205, 235);
  // WAS 라벨 아래(약 465)에서 레인 헤더 위(약 500)까지 짧게 이어주는 연결선 -
  // 고정값이라 라벨 폰트 크기가 바뀌어도 안전하게 양수 길이를 유지한다.
  const top = 465;
  const length = 30;
  return (
    <line
      x1={960}
      y1={top}
      x2={960}
      y2={top + length * progress}
      stroke={COLORS.line}
      strokeWidth={2}
      opacity={0.7}
      strokeDasharray="4 6"
    />
  );
}

// ---- Act 2: 레인 헤더(레이블 + 안내선) ----
function LaneHeader({ frame, lane }) {
  const p = progressBetween(frame, 215, 245);
  return (
    <g opacity={p}>
      <text
        x={lane.x}
        y={LANE_LABEL_Y}
        fill={COLORS.textDim}
        fontSize={18}
        fontWeight={700}
        letterSpacing={2}
        textAnchor="middle"
        fontFamily="'SF Mono', 'Menlo', monospace"
      >
        {lane.label}
      </text>
      <line
        x1={lane.x}
        y1={LANE_LABEL_Y + 14}
        x2={lane.x}
        y2={LANE_TOP_Y}
        stroke={COLORS.line}
        strokeWidth={1.5}
        opacity={0.5}
      />
    </g>
  );
}

// ---- Act 2: 정상 로그 - 위에서 아래로 후두둑 떨어지다 페이드 ----
function RainDot({ frame, laneX, spawnFrame, duration, xJitter = 0 }) {
  if (frame < spawnFrame || frame > spawnFrame + duration) return null;
  const t = progressBetween(frame, spawnFrame, spawnFrame + duration);
  const y = interpolate(t, [0, 1], [LANE_TOP_Y, LANE_BOTTOM_Y]);
  const fadeIn = interpolate(t, [0, 0.1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(t, [0.72, 1], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <circle cx={laneX + xJitter} cy={y} r={4} fill={COLORS.safe} opacity={Math.min(fadeIn, fadeOut) * 0.8} />;
}

// ---- Act 2: 이상 로그 - 떨어지다가 상관분석 병합점으로 휘어져 들어간 뒤,
// 빨갛게 변한 채로 수집함 슬롯까지 이동하며 크기가 커졌다 작아지면서 안착함 ----
function AnomalyDot({ frame, laneX, spawnFrame, arriveFrame, slot }) {
  const settleFrame = arriveFrame + SETTLE_DELAY;
  if (frame < spawnFrame || frame > settleFrame) return null;
  const straightPortion = 0.55;
  const t = progressBetween(frame, spawnFrame, arriveFrame);

  let x;
  let y;
  if (t <= straightPortion) {
    const localT = t / straightPortion;
    x = laneX;
    y = interpolate(localT, [0, 1], [LANE_TOP_Y, LANE_TOP_Y + (LANE_BOTTOM_Y - LANE_TOP_Y) * 0.6]);
  } else {
    const localT = (t - straightPortion) / (1 - straightPortion);
    const yStart = LANE_TOP_Y + (LANE_BOTTOM_Y - LANE_TOP_Y) * 0.6;
    x = interpolate(localT, [0, 1], [laneX, MERGE_POINT.x]);
    y = interpolate(localT, [0, 1], [yStart, MERGE_POINT.y]);
  }

  const colorT = progressBetween(frame, arriveFrame - 25, arriveFrame);
  const color = interpolateColors(colorT, [0, 1], [COLORS.safe, COLORS.danger]);
  let glow = interpolate(colorT, [0, 1], [6, 20]);
  let radius = 7;

  // 병합점 도착 이후: 빨간 원이 수집함 슬롯 위치로 이동하면서 커졌다 작아지는
  // 펀치감 있는 진입 애니메이션 (24% 지점에서 최대 크기, 이후 안착 크기로 수렴)
  if (frame > arriveFrame && slot) {
    const entryT = progressBetween(frame, arriveFrame, settleFrame);
    x = interpolate(entryT, [0, 1], [MERGE_POINT.x, slot.x]);
    y = interpolate(entryT, [0, 1], [MERGE_POINT.y, slot.y]);
    radius = interpolate(entryT, [0, 0.4, 1], [7, 18, 10], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    glow = interpolate(entryT, [0, 0.4, 1], [20, 34, 16], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  }

  const fadeIn = interpolate(t, [0, 0.08], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <circle
      cx={x}
      cy={y}
      r={radius}
      fill={color}
      opacity={fadeIn}
      style={{ filter: `drop-shadow(0 0 ${glow}px ${color})` }}
    />
  );
}

// ---- Act 2: 상관분석 병합점 - 은은하게 숨쉬는 글로우 링, 이벤트가 도착하면 반짝 ----
function MergeGlow({ frame, hitFrames }) {
  const appear = progressBetween(frame, 240, 260);
  const breathe = 0.5 + Math.sin(frame * 0.08) * 0.25;
  let flash = 0;
  hitFrames.forEach((hf) => {
    const f = progressBetween(frame, hf - 6, hf) * (1 - progressBetween(frame, hf, hf + 18));
    flash = Math.max(flash, f);
  });
  const intensity = Math.min(1, breathe + flash);
  return (
    <circle
      cx={MERGE_POINT.x}
      cy={MERGE_POINT.y}
      r={26 + flash * 20}
      fill="none"
      stroke={flash > 0.3 ? COLORS.danger : COLORS.line}
      strokeWidth={2}
      opacity={appear * (0.35 + intensity * 0.5)}
    />
  );
}

// ---- Act 2 마무리: 빨간 원만 모으는 수집함 ----
function CollectionBox({ frame, hitFrames }) {
  const pop = spring({ frame: frame - 258, fps: FPS, config: { damping: 15, mass: 0.6, stiffness: 110 } });
  const opacity = clamp01(pop);
  if (opacity <= 0.01) return null;

  const activatedT = progressBetween(frame, hitFrames[0] + SETTLE_DELAY, hitFrames[0] + SETTLE_DELAY + 20);
  const borderColor = interpolateColors(activatedT, [0, 1], [COLORS.line, COLORS.danger]);
  // 카운터는 빨간 원이 실제로 슬롯에 안착하는 시점(발화 + 진입 애니메이션)에 맞춰 올라간다.
  const capturedCount = hitFrames.filter((hf) => frame >= hf + SETTLE_DELAY).length * 2;

  return (
    <g opacity={opacity}>
      <rect
        x={BOX.x}
        y={BOX.y}
        width={BOX.w}
        height={BOX.h}
        rx={12}
        fill={`${COLORS.bgAlt}dd`}
        stroke={borderColor}
        strokeWidth={2}
        style={{ filter: `drop-shadow(0 0 ${14 + activatedT * 10}px ${borderColor}88)` }}
      />
      <text
        x={BOX.x + BOX.w / 2}
        y={BOX.y - 16}
        fill={COLORS.textDim}
        fontSize={15}
        letterSpacing={1.5}
        textAnchor="middle"
        fontFamily="'SF Mono', 'Menlo', monospace"
      >
        CORRELATED INCIDENTS: {capturedCount}
      </text>
      {BOX_SLOTS.map((slot, i) => {
        // 진입 애니메이션(커졌다 작아지는 효과)은 AnomalyDot이 이미 그리므로,
        // 여기서는 안착이 끝난 뒤(settleFrame 이후)의 정지된 최종 크기만 유지해서
        // 손끝이 바뀌는 순간 튀지 않고 자연스럽게 이어받는다.
        const hitIndex = Math.floor(i / 2);
        const hf = hitFrames[hitIndex];
        const settleFrame = hf == null ? null : hf + SETTLE_DELAY;
        if (settleFrame == null || frame < settleFrame) return null;
        return (
          <circle
            key={i}
            cx={slot.x}
            cy={slot.y}
            r={10}
            fill={COLORS.danger}
            style={{ filter: `drop-shadow(0 0 10px ${COLORS.danger})` }}
          />
        );
      })}
    </g>
  );
}

// ---- 마무리: 서비스 로고 (등장 -> 화면 중앙에 잠시 머문 뒤 -> 위로 이동하며
// 작아져서 헤더 자리로 정착, 그 아래로 대시보드 리빌이 이어진다) ----
const LOGO_APPEAR = 398;
const LOGO_MOVE_START = 452;
const LOGO_MOVE_END = 492;

function FinaleLogo({ frame }) {
  const pop = spring({ frame: frame - LOGO_APPEAR, fps: FPS, config: { damping: 16, mass: 0.7, stiffness: 100 } });
  const opacity = clamp01(pop);
  if (opacity <= 0.01) return null;
  const popScale = interpolate(pop, [0, 1], [0.85, 1], { extrapolateRight: "clamp" });

  const moveT = progressBetween(frame, LOGO_MOVE_START, LOGO_MOVE_END);
  const translateY = interpolate(moveT, [0, 1], [0, -462]);
  const shrink = interpolate(moveT, [0, 1], [1, 0.5]);
  const scale = popScale * shrink;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 560,
        textAlign: "center",
        opacity,
        transform: `translateY(${translateY}px) scale(${scale})`,
        fontFamily: "'SF Mono', 'Menlo', monospace",
      }}
    >
      <div
        style={{
          color: COLORS.safe,
          fontSize: 72,
          fontWeight: 800,
          letterSpacing: 10,
          textShadow: `0 0 30px ${COLORS.safe}99, 0 0 60px ${COLORS.safe}44`,
        }}
      >
        SENTINEL-OPS
      </div>
      <div style={{ color: COLORS.textDim, fontSize: 18, letterSpacing: 3, marginTop: 14 }}>
        4-LAYER LOG CORRELATION · REAL-TIME INCIDENT CAPTURE
      </div>
    </div>
  );
}

// ---- 마무리: 로고가 위로 정착한 뒤, 실제 대시보드를 화이트/블랙 반반으로 공개 ----
const REVEAL_START = 470;
const REVEAL_END = 522;

function SplitDashboardReveal({ frame }) {
  const p = progressBetween(frame, REVEAL_START, REVEAL_END);
  if (p <= 0.001) return null;
  const scale = interpolate(p, [0, 1], [0.94, 1], { extrapolateRight: "clamp" });
  const translateY = interpolate(p, [0, 1], [36, 0], { extrapolateRight: "clamp" });

  const panelW = 1620;
  const panelH = 500;

  const Half = ({ src, label, labelColor, borderStyle }) => (
    <div
      style={{
        width: "50%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 22px",
        boxSizing: "border-box",
        ...borderStyle,
      }}
    >
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <img
          src={staticFile(src)}
          style={{ width: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 6 }}
        />
      </div>
      <div
        style={{
          marginTop: 10,
          color: labelColor,
          fontSize: 13,
          letterSpacing: 3,
          fontFamily: "'SF Mono', 'Menlo', monospace",
        }}
      >
        {label}
      </div>
    </div>
  );

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: 300,
        width: panelW,
        height: panelH,
        transform: `translate(-50%, ${translateY}px) scale(${scale})`,
        opacity: p,
        borderRadius: 18,
        overflow: "hidden",
        display: "flex",
        backgroundColor: COLORS.bgAlt,
        boxShadow: `0 30px 90px #000000b3, 0 0 0 1px ${COLORS.line}55`,
      }}
    >
      <Half src="overview-white.png" label="LIGHT MODE" labelColor="#5B6180" borderStyle={{ backgroundColor: "#F4F5FA" }} />
      <Half
        src="overview-black.png"
        label="DARK MODE"
        labelColor={COLORS.textDim}
        borderStyle={{ backgroundColor: "#030305", borderLeft: `1px solid ${COLORS.line}` }}
      />
    </div>
  );
}

export function ArchTreeDemo() {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  // 서로 다른 두 계층이 동시에 병합점에 도착 = 상관분석 히트 (correlation-engine의
  // 크로스소스 상관분석과 같은 개념) - 이벤트마다 로그 2개가 겹쳐서 도착한다.
  const HIT_FRAMES = [320, 390];

  // Act 2 진입 후 레인이 계속 흐르다가 마지막에 로고가 뜨면서 서서히 사그라든다.
  const rainFade = interpolate(frame, [400, 440], [1, 0.12], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // 로고가 위로 이동을 시작하기 전까지 트리/레인/수집함 씬 전체를 한번 더
  // 페이드아웃해서, 대시보드 리빌 뒤로 잔상이 겹쳐 보이지 않게 정리한다.
  const sceneFade = interpolate(frame, [LOGO_MOVE_START, REVEAL_START], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill>
      <CyberBackground frame={frame} />
      <BrandMark frame={frame} />

      <AbsoluteFill style={{ opacity: sceneFade }}>
      <svg width={width} height={height} style={{ position: "absolute", top: 0, left: 0 }}>
        {/* Act 1: 외부 접속 -> WAF/Ingress -> WAS:1/2/3 */}
        <TreeEdge from={NODE.external} to={NODE.ingress} drawStart={40} drawEnd={80} frame={frame} />
        <TreeEdge from={NODE.ingress} to={NODE.was1} drawStart={90} drawEnd={150} frame={frame} />
        <TreeEdge from={NODE.ingress} to={NODE.was2} drawStart={120} drawEnd={180} frame={frame} />
        <TreeEdge from={NODE.ingress} to={NODE.was3} drawStart={150} drawEnd={210} frame={frame} />
        <TravelingDot from={NODE.ingress} to={NODE.was1} activeFrom={150} loopLength={50} frame={frame} phaseOffset={0} />
        <TravelingDot from={NODE.ingress} to={NODE.was2} activeFrom={180} loopLength={55} frame={frame} phaseOffset={12} />
        <TravelingDot from={NODE.ingress} to={NODE.was3} activeFrom={210} loopLength={60} frame={frame} phaseOffset={28} />

        <Bridge frame={frame} />

        {/* Act 2: 4개 로그 계층 + 상관분석 병합 + 수집함 */}
        <g opacity={rainFade}>
          {LANES.map((lane) => (
            <LaneHeader key={lane.key} frame={frame} lane={lane} />
          ))}

          {/* WAS 레인 */}
          <RainDot frame={frame} laneX={LANES[0].x} spawnFrame={235} duration={110} xJitter={-14} />
          <RainDot frame={frame} laneX={LANES[0].x} spawnFrame={255} duration={110} xJitter={10} />
          <RainDot frame={frame} laneX={LANES[0].x} spawnFrame={295} duration={110} xJitter={-6} />
          <RainDot frame={frame} laneX={LANES[0].x} spawnFrame={355} duration={100} xJitter={16} />
          <RainDot frame={frame} laneX={LANES[0].x} spawnFrame={375} duration={90} xJitter={-10} />
          <AnomalyDot frame={frame} laneX={LANES[0].x} spawnFrame={250} arriveFrame={320} slot={BOX_SLOTS[0]} />

          {/* WAF 레인 */}
          <RainDot frame={frame} laneX={LANES[1].x} spawnFrame={240} duration={110} xJitter={12} />
          <RainDot frame={frame} laneX={LANES[1].x} spawnFrame={270} duration={105} xJitter={-14} />
          <RainDot frame={frame} laneX={LANES[1].x} spawnFrame={310} duration={100} xJitter={8} />
          <RainDot frame={frame} laneX={LANES[1].x} spawnFrame={360} duration={95} xJitter={-8} />
          <RainDot frame={frame} laneX={LANES[1].x} spawnFrame={385} duration={90} xJitter={14} />
          <AnomalyDot frame={frame} laneX={LANES[1].x} spawnFrame={315} arriveFrame={390} slot={BOX_SLOTS[2]} />

          {/* FALCO 레인 */}
          <RainDot frame={frame} laneX={LANES[2].x} spawnFrame={245} duration={110} xJitter={-10} />
          <RainDot frame={frame} laneX={LANES[2].x} spawnFrame={265} duration={105} xJitter={14} />
          <RainDot frame={frame} laneX={LANES[2].x} spawnFrame={330} duration={100} xJitter={-16} />
          <RainDot frame={frame} laneX={LANES[2].x} spawnFrame={365} duration={95} xJitter={6} />
          <RainDot frame={frame} laneX={LANES[2].x} spawnFrame={390} duration={90} xJitter={-8} />
          <AnomalyDot frame={frame} laneX={LANES[2].x} spawnFrame={255} arriveFrame={320} slot={BOX_SLOTS[1]} />

          {/* K8S AUDIT 레인 */}
          <RainDot frame={frame} laneX={LANES[3].x} spawnFrame={250} duration={110} xJitter={10} />
          <RainDot frame={frame} laneX={LANES[3].x} spawnFrame={280} duration={105} xJitter={-12} />
          <RainDot frame={frame} laneX={LANES[3].x} spawnFrame={340} duration={100} xJitter={16} />
          <RainDot frame={frame} laneX={LANES[3].x} spawnFrame={370} duration={95} xJitter={-6} />
          <RainDot frame={frame} laneX={LANES[3].x} spawnFrame={395} duration={90} xJitter={8} />
          <AnomalyDot frame={frame} laneX={LANES[3].x} spawnFrame={320} arriveFrame={390} slot={BOX_SLOTS[3]} />

          <MergeGlow frame={frame} hitFrames={HIT_FRAMES} />
        </g>

        <CollectionBox frame={frame} hitFrames={HIT_FRAMES} />
      </svg>

      <TreeNode frame={frame} at={NODE.external} size={84} label="EXTERNAL ACCESS" sublabel="0.0.0.0/0" appearFrame={10} />
      <TreeNode frame={frame} at={NODE.ingress} size={84} label="WAF / INGRESS" sublabel="edge filter" appearFrame={34} />
      <TreeNode frame={frame} at={NODE.was1} size={88} label="WAS:1" appearFrame={128} />
      <TreeNode frame={frame} at={NODE.was2} size={88} label="WAS:2" appearFrame={158} />
      <TreeNode frame={frame} at={NODE.was3} size={88} label="WAS:3" appearFrame={188} />
      </AbsoluteFill>

      <FinaleLogo frame={frame} />
      <SplitDashboardReveal frame={frame} />
    </AbsoluteFill>
  );
}
