import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame } from "remotion";

// ---- 영상 스펙 ----
// "공격 대상 서버와 우리 탐지 시스템은 서로 다른 팀, 다른 코드로 개발된다.
// 그래서 각자 포맷대로 로그를 짜면 대상 서버 코드가 바뀔 때마다 우리도
// 손봐야 한다 - 그래서 업계 표준인 OpenTelemetry라는 '하나의 약속'만
// 지키기로 했다" 라는 내레이션을 뒷받침하는 클립. 강조점 두 가지:
// (1) 왼쪽(대상 서버)과 오른쪽(탐지 시스템)은 서로 다른 코드/팀이다
// (2) 그 사이를 잇는 건 각자의 구현이 아니라 OpenTelemetry라는 "하나의
// 약속"뿐이다. 아이콘은 다른 컴포지션들과 동일하게 전부 손으로 그린
// 인라인 SVG (외부 이미지 파일 없음).
export const OTEL_FPS = 30;
export const OTEL_WIDTH = 1920;
export const OTEL_HEIGHT = 1080;
export const OTEL_TOTAL_FRAMES = 480; // 16초 - 마지막 자막이 뜬 뒤에도 데이터가 5초 넘게 계속 흐르다 끝남

const COLORS = {
  bg: "#020203",
  bgDeep: "#0A0A0D",
  amber: "#FFB020", // 대상 서버(외부, 우리가 모르는 코드) 톤
  mint: "#00FFA6", // 우리 탐지 시스템 톤
  violet: "#8B7CF6", // OpenTelemetry(표준/약속) 톤
  critical: "#FF3B4E",
  line: "#4A5170",
  text: "#F2F5FF",
  textDim: "#8890B5",
};

const SANS = "'Noto Sans KR', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const MONO = "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const clamp01 = (v) => Math.min(1, Math.max(0, v));

function progressBetween(frame, start, end) {
  if (end <= start) return frame >= end ? 1 : 0;
  return interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function mixColor(a, b, t) {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const r = Math.round(ar + (br - ar) * clamp01(t));
  const g = Math.round(ag + (bg - ag) * clamp01(t));
  const bl = Math.round(ab + (bb - ab) * clamp01(t));
  return `rgb(${r},${g},${bl})`;
}
// 왼쪽(amber) → 가운데(violet, OTel) → 오른쪽(mint) 3단 그라디언트
function colorForFraction(f) {
  if (f <= 0.5) return mixColor(COLORS.amber, COLORS.violet, f / 0.5);
  return mixColor(COLORS.violet, COLORS.mint, (f - 0.5) / 0.5);
}

// ---- 레이아웃 ----
const LEFT_BOX = { cx: 420, cy: 560, w: 480, h: 520 };
const RIGHT_BOX = { cx: 1500, cy: 560, w: 480, h: 520 };
const GATE_X = 960;
const GATE_Y = 560;
const PIPE_LEFT = LEFT_BOX.cx + LEFT_BOX.w / 2 + 10;
const PIPE_RIGHT = RIGHT_BOX.cx - RIGHT_BOX.w / 2 - 10;

// =====================================================================
// 배경
// =====================================================================
function BridgeBackground({ frame }) {
  const blobs = [
    { cx: 0.18, cy: 0.5, r: 460, color: COLORS.amber, fx: 0.0012, fy: 0.001, ph: 0 },
    { cx: 0.5, cy: 0.5, r: 360, color: COLORS.violet, fx: 0.0016, fy: 0.0014, ph: 1.4 },
    { cx: 0.82, cy: 0.5, r: 460, color: COLORS.mint, fx: 0.0013, fy: 0.0011, ph: 2.8 },
  ];
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(circle, ${COLORS.line}22 1px, transparent 1px)`,
          backgroundSize: "50px 50px",
          opacity: 0.26,
        }}
      />
      {blobs.map((b, i) => {
        const x = (b.cx + Math.sin(frame * b.fx + b.ph) * 0.02) * OTEL_WIDTH;
        const y = (b.cy + Math.cos(frame * b.fy + b.ph) * 0.02) * OTEL_HEIGHT;
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

// =====================================================================
// 좌/우 시스템 박스
// =====================================================================
function SystemBox({ box, color, title, sub, pills, chaotic, pop }) {
  return (
    <div
      style={{
        position: "absolute",
        left: box.cx - box.w / 2,
        top: box.cy - box.h / 2,
        width: box.w,
        height: box.h,
        opacity: clamp01(pop),
        transform: `scale(${interpolate(pop, [0, 1], [0.85, 1])})`,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 22,
          border: `2.5px solid ${color}`,
          background: `${color}0D`,
          boxShadow: `0 0 30px ${color}33 inset`,
        }}
      />
      <div style={{ position: "absolute", left: 0, right: 0, top: -66, textAlign: "center" }}>
        <p style={{ color: COLORS.text, fontSize: 26, fontWeight: 700, margin: 0 }}>{title}</p>
        <p style={{ color: COLORS.textDim, fontSize: 15, margin: "4px 0 0", fontFamily: MONO }}>{sub}</p>
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 22,
        }}
      >
        {pills.map((p, i) => (
          <div
            key={i}
            style={{
              padding: "12px 28px",
              borderRadius: 999,
              border: `2px solid ${color}`,
              color,
              fontFamily: MONO,
              fontSize: 19,
              fontWeight: 600,
              background: `${color}14`,
              transform: chaotic ? `rotate(${[-4, 3, -2][i % 3]}deg) translateX(${[-14, 10, -6][i % 3]}px)` : "none",
            }}
          >
            {p}
          </div>
        ))}
      </div>
    </div>
  );
}

// =====================================================================
// Act 1 - 끊긴 연결 (다른 코드라 직접 연결되지 않는다)
// =====================================================================
function BrokenLink({ frame, opacity }) {
  if (opacity <= 0) return null;
  const dashPhase = -(frame * 1.6) % 24;

  // 두 번의 "연결 시도 실패" 패킷
  const attempts = [
    { start: 66, dur: 34 },
    { start: 112, dur: 34 },
  ];

  return (
    <svg width={OTEL_WIDTH} height={OTEL_HEIGHT} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", opacity }}>
      <line
        x1={PIPE_LEFT}
        y1={GATE_Y}
        x2={PIPE_RIGHT}
        y2={GATE_Y}
        stroke={COLORS.critical}
        strokeWidth={3}
        strokeDasharray="14 10"
        strokeDashoffset={dashPhase}
        opacity={0.55}
      />
      {/* 중앙 X */}
      <g opacity={clamp01(progressBetween(frame, 46, 62))}>
        <line x1={GATE_X - 22} y1={GATE_Y - 22} x2={GATE_X + 22} y2={GATE_Y + 22} stroke={COLORS.critical} strokeWidth={7} strokeLinecap="round" />
        <line x1={GATE_X - 22} y1={GATE_Y + 22} x2={GATE_X + 22} y2={GATE_Y - 22} stroke={COLORS.critical} strokeWidth={7} strokeLinecap="round" />
      </g>
      {attempts.map((a, i) => {
        const t = progressBetween(frame, a.start, a.start + a.dur);
        if (t <= 0 || t >= 1) return null;
        const x = PIPE_LEFT + t * (GATE_X - 70 - PIPE_LEFT);
        const fadeOut = clamp01((t - 0.75) / 0.25);
        const burst = t > 0.9;
        return (
          <g key={i}>
            <circle cx={x} cy={GATE_Y} r={8 * (1 - fadeOut * 0.4)} fill={COLORS.amber} opacity={1 - fadeOut} />
            {burst && (
              <circle
                cx={GATE_X - 70}
                cy={GATE_Y}
                r={10 + (t - 0.9) * 260}
                fill="none"
                stroke={COLORS.critical}
                strokeWidth={2.5}
                opacity={clamp01(1 - (t - 0.9) * 10)}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

// =====================================================================
// OpenTelemetry 게이트 아이콘 - 실제 OTel 로고의 "망원경/렌즈" 느낌을
// 살려 육각형 + 겹친 원호로 재해석
// =====================================================================
function OtelGateIcon({ size = 150, color, pulse = 0 }) {
  const hexPts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return [Math.cos(a) * 56, Math.sin(a) * 56];
  })
    .map((p) => p.join(","))
    .join(" ");
  return (
    <svg width={size} height={size} viewBox="-70 -70 140 140" style={{ overflow: "visible" }}>
      <circle cx={0} cy={0} r={64} fill="none" stroke={color} strokeWidth={2} opacity={0.18 + pulse * 0.22} />
      <polygon points={hexPts} fill={COLORS.bgDeep} stroke={color} strokeWidth={4} opacity={0.9} style={{ filter: `drop-shadow(0 0 14px ${color})` }} />
      {[26, 17, 8].map((r, i) => (
        <circle key={i} cx={0} cy={0} r={r} fill="none" stroke={color} strokeWidth={4 - i} opacity={0.9 - i * 0.12} />
      ))}
      <circle cx={0} cy={0} r={4} fill={color} />
    </svg>
  );
}

// =====================================================================
// 파이프 - 게이트 등장 이후, 왼쪽(amber) → 가운데(violet) → 오른쪽(mint)로
// 색이 자연스럽게 섞이며 데이터가 계속 흐르는 "표준 규격을 통과하는" 관
// =====================================================================
function Pipe({ frame, opacity, loopStart, loopFrames, count = 4 }) {
  if (opacity <= 0) return null;
  const gradId = "otel-pipe-grad";
  const local = frame - loopStart;

  const dots = [];
  if (local >= 0) {
    for (let i = 0; i < count; i++) {
      const phase = i / count;
      const t = (local / loopFrames + phase) % 1;
      const x = PIPE_LEFT + t * (PIPE_RIGHT - PIPE_LEFT);
      const edgeFade = Math.min(t / 0.05, 1, (1 - t) / 0.05, 1);
      dots.push({ x, color: colorForFraction(t), opacity: clamp01(edgeFade) });
    }
  }

  return (
    <svg width={OTEL_WIDTH} height={OTEL_HEIGHT} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", opacity }}>
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={COLORS.amber} />
          <stop offset="50%" stopColor={COLORS.violet} />
          <stop offset="100%" stopColor={COLORS.mint} />
        </linearGradient>
      </defs>
      <line x1={PIPE_LEFT} y1={GATE_Y} x2={PIPE_RIGHT} y2={GATE_Y} stroke={`url(#${gradId})`} strokeWidth={4} opacity={0.5} strokeLinecap="round" />
      {dots.map((d, i) => (
        <g key={i}>
          <circle cx={d.x} cy={GATE_Y} r={10} fill={d.color} opacity={d.opacity} style={{ filter: `drop-shadow(0 0 12px ${d.color})` }} />
          <circle cx={d.x} cy={GATE_Y} r={16} fill="none" stroke={d.color} strokeWidth={1.5} opacity={d.opacity * 0.35} />
        </g>
      ))}
    </svg>
  );
}

// =====================================================================
// 메인 컴포지션
// =====================================================================
export function OtelBridgeVideo() {
  const frame = useCurrentFrame();

  const introP = progressBetween(frame, 0, 18);
  const boxPop = spring({ frame: frame - 16, fps: OTEL_FPS, config: { damping: 15, mass: 0.75, stiffness: 120 } });

  // Act 1: 서로 다른 코드라 직접 연결되지 않는다
  const painCaptionP = progressBetween(frame, 78, 100) * (1 - progressBetween(frame, 150, 165));
  const brokenOpacity = 1 - progressBetween(frame, 150, 168);

  // Act 2: OpenTelemetry라는 하나의 약속이 등장
  const gatePop = spring({ frame: frame - 168, fps: OTEL_FPS, config: { damping: 13, mass: 0.7, stiffness: 150 } });
  const gateLabelP = progressBetween(frame, 176, 196);
  const gateSubP = progressBetween(frame, 202, 222);

  // Act 3: 표준을 통과해 계속 흐른다
  const PIPE_LOOP_START = 172;
  const PIPE_LOOP_FRAMES = 130;
  const pipeOpacity = progressBetween(frame, 168, 184);

  const finalCaptionP = progressBetween(frame, 250, 274);

  // 최종 자막(약 9초 지점)이 뜬 뒤로도 데이터가 계속 흐르다가, 마지막
  // 16프레임에서만 부드럽게 페이드아웃.
  const blackoutP = progressBetween(frame, OTEL_TOTAL_FRAMES - 16, OTEL_TOTAL_FRAMES);

  return (
    <AbsoluteFill style={{ fontFamily: SANS }}>
      <BridgeBackground frame={frame} />

      <AbsoluteFill style={{ opacity: clamp01(introP) }}>
        {/* 타이틀 */}
        <div style={{ position: "absolute", left: 0, right: 0, top: 70, textAlign: "center" }}>
          <p style={{ color: COLORS.text, fontSize: 32, fontWeight: 700, margin: 0 }}>
            서로 다른 코드, 서로 다른 팀
          </p>
        </div>

        <SystemBox
          box={LEFT_BOX}
          color={COLORS.amber}
          title="공격 대상 서버"
          sub="다른 팀 · 다른 코드베이스"
          pills={["Node.js", "PHP", "Java"]}
          chaotic
          pop={boxPop}
        />
        <SystemBox
          box={RIGHT_BOX}
          color={COLORS.mint}
          title="SENTINEL-OPS 탐지 시스템"
          sub="우리 팀 · 우리 코드베이스"
          pills={["탐지 로직", "상관 분석", "저장"]}
          chaotic={false}
          pop={boxPop}
        />

        <BrokenLink frame={frame} opacity={clamp01(brokenOpacity) * clamp01(progressBetween(frame, 40, 50))} />

        <Pipe frame={frame} opacity={clamp01(pipeOpacity)} loopStart={PIPE_LOOP_START} loopFrames={PIPE_LOOP_FRAMES} count={4} />

        {/* Act1 페인 포인트 캡션 */}
        <div style={{ position: "absolute", left: 0, right: 0, top: GATE_Y + 90, textAlign: "center", opacity: clamp01(painCaptionP) }}>
          <p style={{ color: COLORS.critical, fontSize: 20, margin: 0, fontWeight: 600 }}>
            포맷이 다르면, 대상 서버 코드가 바뀔 때마다 우리도 같이 손봐야 합니다
          </p>
        </div>

        {/* OpenTelemetry 게이트 */}
        <div
          style={{
            position: "absolute",
            left: GATE_X - 90,
            top: GATE_Y - 170,
            width: 180,
            textAlign: "center",
            opacity: clamp01(gatePop),
            transform: `scale(${interpolate(gatePop, [0, 1], [0.5, 1])})`,
          }}
        >
          <OtelGateIcon size={150} color={COLORS.violet} pulse={0.5 + 0.5 * Math.sin(frame * 0.07)} />
        </div>

        {/* 게이트 라벨 */}
        <div style={{ position: "absolute", left: 0, right: 0, top: GATE_Y - 260, textAlign: "center", opacity: clamp01(gateLabelP) }}>
          <p
            style={{
              color: COLORS.violet,
              fontSize: 30,
              fontWeight: 800,
              margin: 0,
              textShadow: `0 0 18px ${COLORS.violet}`,
              letterSpacing: 0.5,
            }}
          >
            하나의 약속: OpenTelemetry
          </p>
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: GATE_Y + 90, textAlign: "center", opacity: clamp01(gateSubP) }}>
          <p style={{ color: COLORS.textDim, fontSize: 19, margin: 0, fontFamily: MONO }}>
            표준 규격만 맞추면, 내부 구현은 서로 몰라도 됩니다
          </p>
        </div>

        {/* 최종 강조 캡션 */}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 78, textAlign: "center", opacity: clamp01(finalCaptionP) }}>
          <p style={{ color: COLORS.text, fontSize: 27, fontWeight: 700, margin: 0 }}>
            대상 서버가 내부적으로 무엇을 하든,{" "}
            <span style={{ color: COLORS.mint, textShadow: `0 0 14px ${COLORS.mint}` }}>우리는 신경 쓰지 않습니다</span>
          </p>
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{ backgroundColor: "#000000", opacity: blackoutP }} />
    </AbsoluteFill>
  );
}
