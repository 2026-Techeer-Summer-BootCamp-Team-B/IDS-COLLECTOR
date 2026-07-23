import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame } from "remotion";

// ---- 영상 스펙 ----
// 슬라이드 1("100억 건+ ... 전 인류의 인구수보다 많은 데이터")을 뒷받침하는
// 짧은 비교 그래프 영상. HackerTypingIntro와는 완전히 별개의 컴포지션 -
// "세계 인구" 라인과 "누적 개인정보 유출 건수" 라인이 주식 차트처럼 아래에서
// 위로 그려지다가, 유출 건수 라인이 인구 라인을 추월하는 순간을 보여준다.
// 톤은 같은 다크 네온 팔레트를 쓰되 SENTINEL-OPS 브랜딩은 없음(이건 "문제
// 제기" 파트용 데이터 시각화 클립).
export const CHART_FPS = 30;
export const CHART_WIDTH = 1920;
export const CHART_HEIGHT = 1080;
export const CHART_TOTAL_FRAMES = 180; // 6초

const COLORS = {
  bg: "#020203",
  bgDeep: "#0A0A0D",
  mint: "#00FFA6",
  critical: "#FF1F4B",
  cyan: "#3FD9FF",
  line: "#4A5170",
  grid: "#2A3050",
  text: "#F2F5FF",
  textDim: "#8890B5",
};

const SANS = "'Noto Sans KR', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const MONO = "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

function progressBetween(frame, start, end) {
  if (end <= start) return frame >= end ? 1 : 0;
  return interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

// 결정적 pseudo-random (프로젝트 전역에서 쓰는 관습)
function sr(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// ---- 실제 참고 수치 ----
// 세계 인구: 2025년 기준 약 82억 명(유엔 추계 반올림). 누적 개인정보 유출
// 건수: 발표 대본의 "100억 건+"를 그대로 씀 - 두 수치 다 "억" 단위 축으로
// 그린다(100억 = 10,000,000,000).
const POP_CAP = 82; // 억 명
const BREACH_CAP = 104; // 억 건 ("100억 건+"를 표현하기 위해 약간 여유를 둠)
const AXIS_MAX = 120; // 억 단위 축 최대값
const SAMPLES = 64;

// x=0..1 구간에 대해 부드러운 상승 곡선 + 주식차트 느낌의 잔물결 노이즈를
// 얹은 포인트 배열을 만든다. capValue에 점근하고, 노이즈는 프레임과 무관한
// 고정 시드라 매번 같은 모양으로 그려진다(렌더 재현성 보장).
function buildCurve(capValue, noiseAmp, seedBase) {
  const pts = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t = i / (SAMPLES - 1);
    const base = capValue * easeOutCubic(t);
    // 초반엔 노이즈를 작게, 끝으로 갈수록도 과하지 않게 - 값이 0 밑으로
    // 내려가거나 캡을 넘어 튀지 않도록 clamp.
    const noise = (sr(seedBase + i * 3.7) - 0.5) * noiseAmp * (0.4 + t * 0.6);
    const y = Math.max(0, Math.min(capValue * 1.04, base + noise));
    pts.push({ t, y });
  }
  return pts;
}

const POP_CURVE = buildCurve(POP_CAP, 3.2, 11);
const BREACH_CURVE = buildCurve(BREACH_CAP, 4.5, 47);

function valueToY(value, chartTop, chartBottom) {
  const frac = clamp01(value / AXIS_MAX);
  return chartBottom - frac * (chartBottom - chartTop);
}

// =====================================================================
// 배경 - 다른 영상들과 같은 톤의 점 격자 + 글로우
// =====================================================================
function ChartBackground({ frame = 0 }) {
  const blobs = [
    { cx: 0.15, cy: 0.2, r: 480, color: COLORS.cyan, fx: 0.0015, fy: 0.0012, ph: 0 },
    { cx: 0.85, cy: 0.85, r: 440, color: COLORS.critical, fx: 0.0013, fy: 0.0017, ph: 2.6 },
  ];
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(circle, ${COLORS.line}22 1px, transparent 1px)`,
          backgroundSize: "50px 50px",
          opacity: 0.3,
        }}
      />
      {blobs.map((b, i) => {
        const x = (b.cx + Math.sin(frame * b.fx + b.ph) * 0.04) * CHART_WIDTH;
        const y = (b.cy + Math.cos(frame * b.fy + b.ph) * 0.04) * CHART_HEIGHT;
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
              background: `radial-gradient(circle, ${b.color}12 0%, ${b.color}00 70%)`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
}

// =====================================================================
// 차트 본체
// =====================================================================
const CHART_LEFT = 160;
const CHART_RIGHT = 1820;
const CHART_TOP = 190;
const CHART_BOTTOM = 860;

function GridAndAxes() {
  const steps = [0, 20, 40, 60, 80, 100, 120];
  return (
    <svg width={CHART_WIDTH} height={CHART_HEIGHT} style={{ position: "absolute", left: 0, top: 0 }}>
      {steps.map((v) => {
        const y = valueToY(v, CHART_TOP, CHART_BOTTOM);
        return (
          <g key={v}>
            <line x1={CHART_LEFT} y1={y} x2={CHART_RIGHT} y2={y} stroke={COLORS.grid} strokeWidth={1} opacity={0.5} />
            <text x={CHART_LEFT - 20} y={y + 6} textAnchor="end" fontFamily={MONO} fontSize={18} fill={COLORS.textDim}>
              {v === 0 ? "0" : `${v}억`}
            </text>
          </g>
        );
      })}
      <line x1={CHART_LEFT} y1={CHART_TOP - 20} x2={CHART_LEFT} y2={CHART_BOTTOM} stroke={COLORS.line} strokeWidth={1.5} opacity={0.7} />
      <line x1={CHART_LEFT} y1={CHART_BOTTOM} x2={CHART_RIGHT} y2={CHART_BOTTOM} stroke={COLORS.line} strokeWidth={1.5} opacity={0.7} />
    </svg>
  );
}

function ChartLine({ frame, curve, color, drawStart, drawFrames, glow }) {
  const t = progressBetween(frame, drawStart, drawStart + drawFrames);
  const revealCount = Math.max(1, Math.round(t * (SAMPLES - 1)) + 1);
  const visible = curve.slice(0, revealCount);

  const points = visible
    .map((p) => {
      const x = CHART_LEFT + p.t * (CHART_RIGHT - CHART_LEFT);
      const y = valueToY(p.y, CHART_TOP, CHART_BOTTOM);
      return `${x},${y}`;
    })
    .join(" ");

  const tip = visible[visible.length - 1];
  const tipX = CHART_LEFT + tip.t * (CHART_RIGHT - CHART_LEFT);
  const tipY = valueToY(tip.y, CHART_TOP, CHART_BOTTOM);

  // 채우기(면적) - 라인 아래를 살짝 톤 다운된 같은 색으로 채워서 "차트"
  // 느낌을 더한다.
  const areaPoints = `${CHART_LEFT},${CHART_BOTTOM} ${points} ${tipX},${CHART_BOTTOM}`;

  return (
    <svg width={CHART_WIDTH} height={CHART_HEIGHT} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
      <defs>
        <linearGradient id={`fill-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#fill-${color})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={tipX} cy={tipY} r={7} fill={color} opacity={glow} style={{ filter: `drop-shadow(0 0 12px ${color})` }} />
      <circle cx={tipX} cy={tipY} r={13} fill="none" stroke={color} strokeWidth={2} opacity={glow * 0.5} />
    </svg>
  );
}

// 두 라인이 교차하는 x 지점을 찾아 "추월" 마커를 찍는다.
function findCrossX(popCurve, breachCurve) {
  for (let i = 1; i < popCurve.length; i++) {
    const prevDiff = breachCurve[i - 1].y - popCurve[i - 1].y;
    const currDiff = breachCurve[i].y - popCurve[i].y;
    if (prevDiff < 0 && currDiff >= 0) {
      return (popCurve[i - 1].t + popCurve[i].t) / 2;
    }
  }
  return null;
}

// =====================================================================
// 메인 컴포지션
// =====================================================================
export function BreachVsPopulationChart() {
  const frame = useCurrentFrame();

  const introP = progressBetween(frame, 0, 16);

  const POP_DRAW_START = 20;
  const POP_DRAW_FRAMES = 90; // 인구선은 먼저 다 그려져서 정체된 느낌
  const BREACH_DRAW_START = 20;
  const BREACH_DRAW_FRAMES = 132; // 유출선은 계속 더 올라간다

  const popGlow = spring({ frame: frame - POP_DRAW_START - 6, fps: CHART_FPS, config: { damping: 200 } });
  const breachGlow = spring({ frame: frame - BREACH_DRAW_START - 6, fps: CHART_FPS, config: { damping: 200 } });

  const crossX = findCrossX(POP_CURVE, BREACH_CURVE);
  const crossFrame = crossX != null ? BREACH_DRAW_START + crossX * BREACH_DRAW_FRAMES : null;
  const crossFlash = crossFrame != null ? clamp01(1 - Math.abs(frame - crossFrame) / 10) : 0;

  const labelP = progressBetween(frame, BREACH_DRAW_START + BREACH_DRAW_FRAMES - 4, BREACH_DRAW_START + BREACH_DRAW_FRAMES + 14);
  const labelPop = spring({ frame: frame - (POP_DRAW_START + POP_DRAW_FRAMES), fps: CHART_FPS, config: { damping: 14, stiffness: 160 } });
  const labelBreach = spring({
    frame: frame - (BREACH_DRAW_START + BREACH_DRAW_FRAMES - 6),
    fps: CHART_FPS,
    config: { damping: 13, stiffness: 170 },
  });

  const popTip = POP_CURVE[POP_CURVE.length - 1];
  const breachTip = BREACH_CURVE[BREACH_CURVE.length - 1];
  const popTipX = CHART_LEFT + popTip.t * (CHART_RIGHT - CHART_LEFT);
  const popTipY = valueToY(popTip.y, CHART_TOP, CHART_BOTTOM);
  const breachTipX = CHART_LEFT + breachTip.t * (CHART_RIGHT - CHART_LEFT);
  const breachTipY = valueToY(breachTip.y, CHART_TOP, CHART_BOTTOM);

  const blackoutP = progressBetween(frame, CHART_TOTAL_FRAMES - 8, CHART_TOTAL_FRAMES);

  return (
    <AbsoluteFill style={{ fontFamily: SANS }}>
      <ChartBackground frame={frame} />

      <AbsoluteFill style={{ opacity: clamp01(introP) }}>
        {/* 상단 타이틀 */}
        <div style={{ position: "absolute", left: CHART_LEFT, top: 90 }}>
          <p style={{ color: COLORS.text, fontSize: 30, fontWeight: 700, margin: 0, letterSpacing: 0.5 }}>
            유출된 개인정보, 이미 인류를 넘어섰습니다
          </p>
        </div>

        <GridAndAxes />

        {/* 인구 라인 (파랑) */}
        <ChartLine
          frame={frame}
          curve={POP_CURVE}
          color={COLORS.cyan}
          drawStart={POP_DRAW_START}
          drawFrames={POP_DRAW_FRAMES}
          glow={clamp01(popGlow)}
        />
        {/* 유출 건수 라인 (레드) */}
        <ChartLine
          frame={frame}
          curve={BREACH_CURVE}
          color={COLORS.critical}
          drawStart={BREACH_DRAW_START}
          drawFrames={BREACH_DRAW_FRAMES}
          glow={clamp01(breachGlow)}
        />

        {/* 추월 지점 플래시 */}
        {crossFlash > 0 && crossX != null && (
          <svg width={CHART_WIDTH} height={CHART_HEIGHT} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
            <circle
              cx={CHART_LEFT + crossX * (CHART_RIGHT - CHART_LEFT)}
              cy={valueToY(POP_CAP * easeOutCubic(crossX), CHART_TOP, CHART_BOTTOM)}
              r={22 * (1 + (1 - crossFlash))}
              fill="none"
              stroke={COLORS.critical}
              strokeWidth={2}
              opacity={crossFlash * 0.8}
            />
          </svg>
        )}

        {/* 인구 라벨 */}
        <div
          style={{
            position: "absolute",
            left: popTipX + 20,
            top: popTipY - 44,
            opacity: clamp01(labelPop),
            transform: `translateY(${interpolate(labelPop, [0, 1], [12, 0])}px)`,
          }}
        >
          <p style={{ color: COLORS.cyan, fontSize: 20, margin: 0, fontFamily: MONO }}>세계 인구</p>
          <p style={{ color: COLORS.text, fontSize: 30, fontWeight: 700, margin: 0 }}>약 82억 명</p>
        </div>

        {/* 유출 건수 라벨 */}
        <div
          style={{
            position: "absolute",
            left: Math.min(breachTipX + 20, CHART_WIDTH - 360),
            top: breachTipY - 60,
            opacity: clamp01(labelBreach),
            transform: `scale(${interpolate(labelBreach, [0, 1], [0.7, 1])})`,
            transformOrigin: "left center",
          }}
        >
          <p style={{ color: COLORS.critical, fontSize: 20, margin: 0, fontFamily: MONO }}>유출된 개인정보</p>
          <p
            style={{
              color: COLORS.critical,
              fontSize: 46,
              fontWeight: 800,
              margin: 0,
              textShadow: `0 0 26px ${COLORS.critical}`,
              letterSpacing: 1,
            }}
          >
            100억 건+
          </p>
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{ backgroundColor: "#000000", opacity: blackoutP }} />
    </AbsoluteFill>
  );
}
