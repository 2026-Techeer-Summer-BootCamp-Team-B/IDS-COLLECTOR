import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame } from "remotion";

// ---- 영상 스펙 ----
// 발표 슬라이드 4(아키텍처: 기술 스택과 데이터 흐름)를 대체하는 자막 포함
// 독립 영상. "건물에 누군가 들어와서 돌아다니는 상황" 비유를 끝까지 밀고
// 나가서, WAF/WAS/Falco/K8s Audit → Kafka/OTel/normalizer → correlation-engine
// (Threshold/Sequence) → OpenSearch/ClickHouse/PostgreSQL 3분기 저장까지
// 순서대로 보여준다. BreachPatternIntro.jsx와 같은 톤(다크 네온, CSS/SVG only,
// Noto Sans KR)을 그대로 따르되 이 영상은 완전히 새로 만든 별도 컴포지션.
export const ARCH_FPS = 30;
export const ARCH_WIDTH = 1920;
export const ARCH_HEIGHT = 1080;

const COLORS = {
  bg: "#030305",
  bgDeep: "#0D0D10",
  mint: "#00FFA6",
  pink: "#A64DFF",
  was: "#00C2FF",
  high: "#FF7A18",
  critical: "#FF1F4B",
  line: "#5A6288",
  text: "#F2F5FF",
  textDim: "#8890B5",
};

const SANS = "'Noto Sans KR', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const clamp01 = (v) => Math.min(1, Math.max(0, v));

function progressBetween(frame, start, end) {
  if (end <= start) return frame >= end ? 1 : 0;
  return interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

// ---- 배경: BreachPatternIntro와 동일한 톤의 점 격자 + 떠다니는 글로우 블롭 ----
function CyberBackground({ frame = 0 }) {
  const blobs = [
    { cx: 0.2, cy: 0.25, r: 520, color: COLORS.mint, fx: 0.0018, fy: 0.0015, ph: 0 },
    { cx: 0.8, cy: 0.75, r: 480, color: COLORS.was, fx: 0.0015, fy: 0.002, ph: 2.4 },
  ];
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(circle, ${COLORS.line}33 1px, transparent 1px)`,
          backgroundSize: "48px 48px",
          opacity: 0.35,
        }}
      />
      {blobs.map((b, i) => {
        const x = (b.cx + Math.sin(frame * b.fx + b.ph) * 0.05) * ARCH_WIDTH;
        const y = (b.cy + Math.cos(frame * b.fy + b.ph) * 0.05) * ARCH_HEIGHT;
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
              background: `radial-gradient(circle, ${b.color}1c 0%, ${b.color}00 70%)`,
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
// 아이콘 (전부 CSS/SVG only, 외부 이미지 없음)
// =====================================================================
function BuildingSilhouette({ size = 240, color }) {
  const rows = 4;
  const cols = 3;
  return (
    <svg width={size} height={size * 1.15} viewBox="-90 -110 180 220" style={{ overflow: "visible" }}>
      <rect x={-70} y={-90} width={140} height={190} rx={4} fill="none" stroke={color} strokeWidth={4} opacity={0.75} />
      {Array.from({ length: rows }).map((_, row) =>
        Array.from({ length: cols }).map((__, col) => (
          <rect key={`${row}-${col}`} x={-52 + col * 38} y={-72 + row * 38} width={20} height={20} fill={color} opacity={0.16} />
        ))
      )}
      <rect x={-18} y={62} width={36} height={38} fill="none" stroke={color} strokeWidth={4} opacity={0.9} style={{ filter: `drop-shadow(0 0 10px ${color})` }} />
    </svg>
  );
}

function ShieldCheckIcon({ size = 160, color }) {
  return (
    <svg width={size} height={size} viewBox="-60 -70 120 140" style={{ overflow: "visible" }}>
      <path
        d="M0 -60 L50 -42 L50 5 C50 40 25 58 0 68 C-25 58 -50 40 -50 5 L-50 -42 Z"
        fill="none"
        stroke={color}
        strokeWidth={6}
        style={{ filter: `drop-shadow(0 0 14px ${color})` }}
      />
      <path d="M-20 5 L-5 22 L24 -14" fill="none" stroke={color} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrailIcon({ size = 160, color }) {
  const points = [
    [-60, 40],
    [-20, 8],
    [15, 30],
    [50, -8],
    [72, -40],
  ];
  const d = points.map((p, i) => (i === 0 ? `M${p[0]} ${p[1]}` : `L${p[0]} ${p[1]}`)).join(" ");
  return (
    <svg width={size} height={size} viewBox="-90 -60 170 120" style={{ overflow: "visible" }}>
      <path d={d} fill="none" stroke={color} strokeWidth={4} strokeDasharray="2 10" strokeLinecap="round" opacity={0.85} />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p[0]}
          cy={p[1]}
          r={i === points.length - 1 ? 9 : 6}
          fill={color}
          opacity={i === points.length - 1 ? 1 : 0.55}
          style={i === points.length - 1 ? { filter: `drop-shadow(0 0 10px ${color})` } : undefined}
        />
      ))}
    </svg>
  );
}

function RadarSensorIcon({ size = 160, color, frame = 0 }) {
  return (
    <svg width={size} height={size} viewBox="-80 -80 160 160" style={{ overflow: "visible" }}>
      <circle r={70} fill="none" stroke={color} strokeWidth={2.5} opacity={0.3} />
      <circle r={44} fill="none" stroke={color} strokeWidth={2.5} opacity={0.45} />
      <circle r={18} fill="none" stroke={color} strokeWidth={2.5} opacity={0.6} />
      <g transform={`rotate(${(frame * 3) % 360})`}>
        <path d="M0 0 L70 0 A70 70 0 0 1 49 49 Z" fill={color} opacity={0.22} />
      </g>
      <circle r={7} fill={color} style={{ filter: `drop-shadow(0 0 12px ${color})` }} />
    </svg>
  );
}

function KeycardIcon({ size = 160, color }) {
  return (
    <svg width={size} height={size * 0.7} viewBox="-90 -60 180 120" style={{ overflow: "visible" }}>
      <rect x={-80} y={-50} width={160} height={100} rx={14} fill="none" stroke={color} strokeWidth={6} style={{ filter: `drop-shadow(0 0 12px ${color})` }} />
      <rect x={-58} y={-28} width={34} height={24} rx={4} fill={color} opacity={0.85} />
      <line x1={-58} y1={18} x2={40} y2={18} stroke={color} strokeWidth={5} strokeLinecap="round" opacity={0.6} />
      <line x1={-58} y1={34} x2={10} y2={34} stroke={color} strokeWidth={5} strokeLinecap="round" opacity={0.4} />
    </svg>
  );
}

function ScatteredFoldersIcon({ size = 340 }) {
  const items = [
    { x: -120, y: -60, rot: -12, color: COLORS.was, label: "WAF" },
    { x: 100, y: -80, rot: 8, color: COLORS.mint, label: "WAS" },
    { x: -90, y: 70, rot: 14, color: COLORS.high, label: "Falco" },
    { x: 110, y: 60, rot: -8, color: COLORS.pink, label: "K8s Audit" },
  ];
  return (
    <svg width={size} height={size * 0.75} viewBox="-200 -160 400 320" style={{ overflow: "visible" }}>
      {items.map((it, i) => (
        <g key={i} transform={`translate(${it.x} ${it.y}) rotate(${it.rot})`}>
          <rect
            x={-40}
            y={-28}
            width={80}
            height={56}
            rx={6}
            fill="none"
            stroke={it.color}
            strokeWidth={4}
            opacity={0.9}
            style={{ filter: `drop-shadow(0 0 8px ${it.color})` }}
          />
          <rect x={-40} y={-36} width={36} height={10} rx={3} fill={it.color} opacity={0.9} />
          <text x={0} y={8} textAnchor="middle" fontFamily={SANS} fontSize={13} fontWeight={800} fill={it.color}>
            {it.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function PipelineIcon({ width = 340, height = 170, frame = 0, color }) {
  const inputs = [-90, -30, 30, 90];
  return (
    <svg width={width} height={height} viewBox="-160 -90 320 180" style={{ overflow: "visible" }}>
      {inputs.map((y, i) => (
        <line key={i} x1={-140} y1={y} x2={-20} y2={y * 0.25} stroke={color} strokeWidth={3} opacity={0.5} />
      ))}
      <path d="M-20 -25 L-20 25 L40 6 L40 -6 Z" fill={color} opacity={0.22} stroke={color} strokeWidth={3} />
      <line x1={40} y1={0} x2={140} y2={0} stroke={color} strokeWidth={4} opacity={0.7} />
      {[0, 1, 2].map((i) => {
        const t = ((frame * 4 + i * 40) % 100) / 100;
        const x = 40 + t * 100;
        return <circle key={i} cx={x} cy={0} r={5} fill={color} style={{ filter: `drop-shadow(0 0 8px ${color})` }} />;
      })}
    </svg>
  );
}

function CorrelationIcon({ size = 260, color, frame = 0 }) {
  const pts = [
    [-90, -70],
    [90, -70],
    [-90, 70],
    [90, 70],
  ];
  return (
    <svg width={size} height={size} viewBox="-140 -120 280 240" style={{ overflow: "visible" }}>
      {pts.map((p, i) => (
        <line
          key={i}
          x1={p[0]}
          y1={p[1]}
          x2={0}
          y2={0}
          stroke={color}
          strokeWidth={2}
          opacity={0.4 + 0.15 * Math.sin(frame * 0.08 + i)}
        />
      ))}
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={9} fill={color} opacity={0.85} />
      ))}
      <circle r={30} fill="none" stroke={color} strokeWidth={5} style={{ filter: `drop-shadow(0 0 14px ${color})` }} />
      <line x1={20} y1={20} x2={44} y2={44} stroke={color} strokeWidth={7} strokeLinecap="round" />
    </svg>
  );
}

function ThresholdIcon({ size = 150, color, frame = 0 }) {
  return (
    <svg width={size} height={size} viewBox="-80 -80 160 160" style={{ overflow: "visible" }}>
      {[0, 1, 2].map((i) => {
        const t = ((frame * 2 + i * 25) % 75) / 75;
        return <circle key={i} r={10 + t * 55} fill="none" stroke={color} strokeWidth={3} opacity={1 - t} />;
      })}
      <circle r={10} fill={color} style={{ filter: `drop-shadow(0 0 12px ${color})` }} />
    </svg>
  );
}

function SequenceIcon({ width = 240, height = 110, color }) {
  const pts = [
    [-90, 20],
    [-30, -30],
    [30, 30],
    [90, -20],
  ];
  const d = pts.map((p, i) => (i === 0 ? `M${p[0]} ${p[1]}` : `L${p[0]} ${p[1]}`)).join(" ");
  return (
    <svg width={width} height={height} viewBox="-110 -60 220 120" style={{ overflow: "visible" }}>
      <path d={d} fill="none" stroke={color} strokeWidth={3} strokeDasharray="6 6" opacity={0.7} />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p[0]} cy={p[1]} r={15} fill={COLORS.bg} stroke={color} strokeWidth={3} />
          <text x={p[0]} y={p[1] + 5} textAnchor="middle" fontFamily={SANS} fontSize={14} fontWeight={800} fill={color}>
            {i + 1}
          </text>
        </g>
      ))}
    </svg>
  );
}

function SearchBoxIcon({ size = 90, color }) {
  return (
    <svg width={size} height={size} viewBox="-45 -45 90 90" style={{ overflow: "visible" }}>
      <circle cx={-6} cy={-6} r={22} fill="none" stroke={color} strokeWidth={6} style={{ filter: `drop-shadow(0 0 10px ${color})` }} />
      <line x1={12} y1={12} x2={32} y2={32} stroke={color} strokeWidth={7} strokeLinecap="round" />
    </svg>
  );
}

function StatsBoxIcon({ size = 90, color }) {
  const bars = [0.4, 0.75, 0.55];
  return (
    <svg width={size} height={size} viewBox="-45 -45 90 90" style={{ overflow: "visible" }}>
      {bars.map((h, i) => (
        <rect key={i} x={-30 + i * 24} y={30 - 60 * h} width={16} height={60 * h} rx={3} fill={color} opacity={0.9} style={{ filter: `drop-shadow(0 0 8px ${color})` }} />
      ))}
    </svg>
  );
}

function LockBoxIcon({ size = 90, color }) {
  return (
    <svg width={size} height={size} viewBox="-45 -45 90 90" style={{ overflow: "visible" }}>
      <rect x={-24} y={-4} width={48} height={38} rx={8} fill="none" stroke={color} strokeWidth={6} style={{ filter: `drop-shadow(0 0 10px ${color})` }} />
      <path d="M-14 -4 L-14 -18 A14 14 0 0 1 14 -18 L14 -4" fill="none" stroke={color} strokeWidth={6} strokeLinecap="round" />
      <circle cx={0} cy={16} r={5} fill={color} />
    </svg>
  );
}

// =====================================================================
// 공용 "Beat" 래퍼 - eyebrow(라벨) + 아이콘 + 헤드라인 + 서브캡션을
// 페이드인/아웃 + 스프링 팝인으로 보여주는 표준 장면 레이아웃
// =====================================================================
function Beat({ frame, startFrame, duration, eyebrow, eyebrowColor, headline, sub, children }) {
  const local = frame - startFrame;
  if (local < -10 || local > duration + 10) return null;

  const sceneIn = progressBetween(local, 0, 20);
  const sceneOut = progressBetween(local, duration - 20, duration);
  const sceneOpacity = clamp01(sceneIn) * (1 - sceneOut);

  const pop = spring({ frame: local, fps: ARCH_FPS, config: { damping: 15, mass: 0.7, stiffness: 130 } });
  const textPop = spring({ frame: local - 8, fps: ARCH_FPS, config: { damping: 15, mass: 0.6, stiffness: 130 } });

  return (
    <AbsoluteFill style={{ opacity: sceneOpacity, alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          textAlign: "center",
          transform: `scale(${interpolate(clamp01(pop), [0, 1], [0.85, 1])})`,
          opacity: clamp01(pop),
        }}
      >
        {eyebrow && (
          <div
            style={{
              fontFamily: SANS,
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: 3,
              color: eyebrowColor || COLORS.mint,
              marginBottom: 26,
              textTransform: "uppercase",
            }}
          >
            {eyebrow}
          </div>
        )}
        <div style={{ marginBottom: 34, display: "flex", justifyContent: "center" }}>{children}</div>
        {headline && (
          <div
            style={{
              fontFamily: SANS,
              fontSize: 42,
              fontWeight: 800,
              color: COLORS.text,
              opacity: clamp01(textPop),
              transform: `translateY(${interpolate(clamp01(textPop), [0, 1], [14, 0])}px)`,
              maxWidth: 1150,
              lineHeight: 1.4,
            }}
          >
            {headline}
          </div>
        )}
        {sub && (
          <div
            style={{
              marginTop: 16,
              fontFamily: SANS,
              fontSize: 22,
              color: COLORS.textDim,
              opacity: clamp01(textPop),
            }}
          >
            {sub}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
}

// =====================================================================
// 개별 장면
// =====================================================================
function IntroScene({ frame, startFrame, duration }) {
  const local = frame - startFrame;
  if (local < -10 || local > duration + 10) return null;
  const sceneIn = progressBetween(local, 0, 20);
  const sceneOut = progressBetween(local, duration - 20, duration);
  const sceneOpacity = clamp01(sceneIn) * (1 - sceneOut);
  const pop = spring({ frame: local, fps: ARCH_FPS, config: { damping: 15, mass: 0.8, stiffness: 120 } });
  const textPop = spring({ frame: local - 10, fps: ARCH_FPS, config: { damping: 15, mass: 0.6, stiffness: 130 } });

  return (
    <AbsoluteFill style={{ opacity: sceneOpacity, alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          textAlign: "center",
          opacity: clamp01(pop),
          transform: `scale(${interpolate(clamp01(pop), [0, 1], [0.88, 1])})`,
        }}
      >
        <BuildingSilhouette color={COLORS.was} />
        <div
          style={{
            marginTop: 30,
            fontFamily: SANS,
            fontSize: 46,
            fontWeight: 800,
            color: COLORS.text,
            lineHeight: 1.5,
            opacity: clamp01(textPop),
            transform: `translateY(${interpolate(clamp01(textPop), [0, 1], [14, 0])}px)`,
          }}
        >
          건물에 누군가 들어와서
          <br />
          돌아다니는 상황이라면?
        </div>
      </div>
    </AbsoluteFill>
  );
}

function FragmentedScene({ frame, startFrame, duration }) {
  const local = frame - startFrame;
  if (local < -10 || local > duration + 10) return null;
  const sceneIn = progressBetween(local, 0, 20);
  const sceneOut = progressBetween(local, duration - 20, duration);
  const sceneOpacity = clamp01(sceneIn) * (1 - sceneOut);
  const pop = spring({ frame: local, fps: ARCH_FPS, config: { damping: 15, mass: 0.7, stiffness: 120 } });
  const textPop = spring({ frame: local - 12, fps: ARCH_FPS, config: { damping: 15, mass: 0.6, stiffness: 130 } });

  return (
    <AbsoluteFill style={{ opacity: sceneOpacity, alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center", opacity: clamp01(pop), transform: `scale(${interpolate(clamp01(pop), [0, 1], [0.88, 1])})` }}>
        <ScatteredFoldersIcon />
        <div
          style={{
            marginTop: 20,
            fontFamily: SANS,
            fontSize: 42,
            fontWeight: 800,
            color: COLORS.text,
            lineHeight: 1.4,
            opacity: clamp01(textPop),
            transform: `translateY(${interpolate(clamp01(textPop), [0, 1], [14, 0])}px)`,
          }}
        >
          문제는, 이 4개의 기록이
          <br />
          따로따로 보관됐다는 것입니다
        </div>
        <div style={{ marginTop: 16, fontFamily: SANS, fontSize: 22, color: COLORS.critical, fontWeight: 700, opacity: clamp01(textPop) }}>
          로그 파편화 문제
        </div>
      </div>
    </AbsoluteFill>
  );
}

function ThresholdSequenceScene({ frame, startFrame, duration }) {
  const local = frame - startFrame;
  if (local < -10 || local > duration + 10) return null;
  const sceneIn = progressBetween(local, 0, 20);
  const sceneOut = progressBetween(local, duration - 20, duration);
  const sceneOpacity = clamp01(sceneIn) * (1 - sceneOut);
  const leftP = spring({ frame: local, fps: ARCH_FPS, config: { damping: 15, mass: 0.7, stiffness: 130 } });
  const rightP = spring({ frame: local - 14, fps: ARCH_FPS, config: { damping: 15, mass: 0.7, stiffness: 130 } });

  const colStyle = (p) => ({
    flex: 1,
    textAlign: "center",
    opacity: clamp01(p),
    transform: `translateY(${interpolate(clamp01(p), [0, 1], [16, 0])}px)`,
    padding: "0 60px",
  });

  return (
    <AbsoluteFill style={{ opacity: sceneOpacity }}>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 140,
          bottom: 140,
          width: 2,
          background: `linear-gradient(180deg, transparent, ${COLORS.line}88, transparent)`,
        }}
      />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center" }}>
        <div style={colStyle(leftP)}>
          <div style={{ fontFamily: SANS, fontSize: 20, fontWeight: 800, letterSpacing: 3, color: COLORS.critical, marginBottom: 22, textTransform: "uppercase" }}>
            Threshold · 임계치
          </div>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 26 }}>
            <ThresholdIcon color={COLORS.critical} frame={frame} />
          </div>
          <div style={{ fontFamily: SANS, fontSize: 30, fontWeight: 800, color: COLORS.text, lineHeight: 1.45 }}>
            같은 곳에서 짧은 시간에
            <br />
            반복되면 수상합니다
          </div>
          <div style={{ marginTop: 14, fontFamily: SANS, fontSize: 18, color: COLORS.textDim }}>
            예: 1분 안에 신분증 확인 실패 수십 번
          </div>
        </div>
        <div style={colStyle(rightP)}>
          <div style={{ fontFamily: SANS, fontSize: 20, fontWeight: 800, letterSpacing: 3, color: COLORS.was, marginBottom: 22, textTransform: "uppercase" }}>
            Sequence · 순차 실행
          </div>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 26 }}>
            <SequenceIcon color={COLORS.was} />
          </div>
          <div style={{ fontFamily: SANS, fontSize: 30, fontWeight: 800, color: COLORS.text, lineHeight: 1.45 }}>
            정문 → 실내 → 민감구역 → 카드키,
            <br />
            이어지는 순서 자체가 단서입니다
          </div>
          <div style={{ marginTop: 14, fontFamily: SANS, fontSize: 18, color: COLORS.textDim }}>
            침입 → 내부 이동 → 기밀 접근, 하나의 이야기로
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

function StorageScene({ frame, startFrame, duration }) {
  const local = frame - startFrame;
  if (local < -10 || local > duration + 10) return null;
  const sceneIn = progressBetween(local, 0, 20);
  const sceneOut = progressBetween(local, duration - 20, duration);
  const sceneOpacity = clamp01(sceneIn) * (1 - sceneOut);
  const headP = spring({ frame: local, fps: ARCH_FPS, config: { damping: 15, mass: 0.6, stiffness: 130 } });

  const stores = [
    { name: "OpenSearch", role: "원본 로그 검색", Icon: SearchBoxIcon, color: COLORS.was },
    { name: "ClickHouse", role: "트렌드 통계 분석", Icon: StatsBoxIcon, color: COLORS.mint },
    { name: "PostgreSQL", role: "사건 상태 관리 (ACID)", Icon: LockBoxIcon, color: COLORS.pink },
  ];

  return (
    <AbsoluteFill style={{ opacity: sceneOpacity, alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          fontFamily: SANS,
          fontSize: 28,
          fontWeight: 700,
          color: COLORS.textDim,
          marginBottom: 50,
          opacity: clamp01(headP),
          transform: `translateY(${interpolate(clamp01(headP), [0, 1], [10, 0])}px)`,
        }}
      >
        판단이 끝난 사건은 성격에 따라 세 곳에 나뉘어 보관됩니다
      </div>
      <div style={{ display: "flex", gap: 70 }}>
        {stores.map((s, i) => {
          const p = spring({ frame: local - 14 - i * 10, fps: ARCH_FPS, config: { damping: 15, mass: 0.6, stiffness: 140 } });
          const Icon = s.Icon;
          return (
            <div
              key={s.name}
              style={{
                width: 280,
                textAlign: "center",
                opacity: clamp01(p),
                transform: `translateY(${interpolate(clamp01(p), [0, 1], [22, 0])}px)`,
              }}
            >
              <div
                style={{
                  width: 130,
                  height: 130,
                  margin: "0 auto",
                  borderRadius: 24,
                  border: `1.5px solid ${s.color}55`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: `${s.color}0d`,
                }}
              >
                <Icon color={s.color} />
              </div>
              <div style={{ marginTop: 20, fontFamily: SANS, fontSize: 26, fontWeight: 800, color: s.color }}>{s.name}</div>
              <div style={{ marginTop: 8, fontFamily: SANS, fontSize: 18, color: COLORS.textDim }}>{s.role}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

function ClosingScene({ frame, startFrame, duration }) {
  const local = frame - startFrame;
  if (local < -10) return null;
  const sceneIn = progressBetween(local, 0, 20);
  const pop = spring({ frame: local, fps: ARCH_FPS, config: { damping: 15, mass: 0.7, stiffness: 120 } });
  const mainP = spring({ frame: local - 20, fps: ARCH_FPS, config: { damping: 14, mass: 0.6, stiffness: 130 } });

  return (
    <AbsoluteFill style={{ opacity: clamp01(sceneIn), alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 28,
            color: COLORS.textDim,
            opacity: clamp01(pop),
            transform: `translateY(${interpolate(clamp01(pop), [0, 1], [10, 0])}px)`,
          }}
        >
          유행하는 기술을 그냥 나열한 게 아니라
        </div>
        <div
          style={{
            marginTop: 16,
            fontFamily: SANS,
            fontSize: 44,
            fontWeight: 800,
            color: COLORS.mint,
            textShadow: `0 0 26px ${COLORS.mint}77`,
            lineHeight: 1.5,
            opacity: clamp01(mainP),
            transform: `translateY(${interpolate(clamp01(mainP), [0, 1], [14, 0])}px)`,
          }}
        >
          각 역할에 가장 적합한 오픈소스를
          <br />
          하나씩 골라 조합했습니다
        </div>
      </div>
    </AbsoluteFill>
  );
}

// =====================================================================
// 메인
// =====================================================================
const INTRO_START = 0;
const INTRO_DUR = 150;
const WAF_START = INTRO_START + INTRO_DUR;
const WAF_DUR = 210;
const WAS_START = WAF_START + WAF_DUR;
const WAS_DUR = 210;
const FALCO_START = WAS_START + WAS_DUR;
const FALCO_DUR = 210;
const K8S_START = FALCO_START + FALCO_DUR;
const K8S_DUR = 210;
const FRAG_START = K8S_START + K8S_DUR;
const FRAG_DUR = 210;
const PIPE_START = FRAG_START + FRAG_DUR;
const PIPE_DUR = 270;
const CORR_START = PIPE_START + PIPE_DUR;
const CORR_DUR = 210;
const TS_START = CORR_START + CORR_DUR;
const TS_DUR = 300;
const STORE_START = TS_START + TS_DUR;
const STORE_DUR = 270;
const CLOSE_START = STORE_START + STORE_DUR;
const CLOSE_DUR = 180;

export const ARCH_TOTAL_FRAMES = CLOSE_START + CLOSE_DUR + 15; // 약 82초

export function ArchAnalogyVideo() {
  const frame = useCurrentFrame();
  const globalFade = progressBetween(frame, 0, 15);

  return (
    <AbsoluteFill style={{ opacity: globalFade }}>
      <CyberBackground frame={frame} />

      <IntroScene frame={frame} startFrame={INTRO_START} duration={INTRO_DUR} />

      <Beat
        frame={frame}
        startFrame={WAF_START}
        duration={WAF_DUR}
        eyebrow="WAF"
        eyebrowColor={COLORS.was}
        headline="정문 보안요원이 신분증과 짐을 확인합니다"
        sub="수상하면 애초에 못 들어오게 걸러냅니다"
      >
        <ShieldCheckIcon color={COLORS.was} />
      </Beat>

      <Beat
        frame={frame}
        startFrame={WAS_START}
        duration={WAS_DUR}
        eyebrow="WAS"
        eyebrowColor={COLORS.mint}
        headline="로비와 사무실을 돌아다니는 동선을 기록합니다"
        sub="웹 애플리케이션 위 사용자 요청 기록"
      >
        <TrailIcon color={COLORS.mint} />
      </Beat>

      <Beat
        frame={frame}
        startFrame={FALCO_START}
        duration={FALCO_DUR}
        eyebrow="Falco"
        eyebrowColor={COLORS.high}
        headline="민감한 구역의 움직임을 감지합니다"
        sub="커널 단, 시스템 가장 깊은 곳의 이상 행동 감시"
      >
        <RadarSensorIcon color={COLORS.high} frame={frame} />
      </Beat>

      <Beat
        frame={frame}
        startFrame={K8S_START}
        duration={K8S_DUR}
        eyebrow="K8s Audit"
        eyebrowColor={COLORS.pink}
        headline="관리자 카드키 사용 기록이 남습니다"
        sub="관리자 권한 행동의 출입기록부"
      >
        <KeycardIcon color={COLORS.pink} />
      </Beat>

      <FragmentedScene frame={frame} startFrame={FRAG_START} duration={FRAG_DUR} />

      <Beat
        frame={frame}
        startFrame={PIPE_START}
        duration={PIPE_DUR}
        eyebrow="OTel · Kafka · Normalizer"
        eyebrowColor={COLORS.was}
        headline="끊김 없이 실시간 전송하고, 하나의 표준 형식으로 정리합니다"
        sub="트래픽이 몰려도 병목 없이, 서로 다른 양식을 통일"
      >
        <PipelineIcon color={COLORS.was} frame={frame} />
      </Beat>

      <Beat
        frame={frame}
        startFrame={CORR_START}
        duration={CORR_DUR}
        eyebrow="Correlation Engine"
        eyebrowColor={COLORS.mint}
        headline="4곳의 기록을 동시에 대조해 수상한 동선을 찾아냅니다"
        sub="32가지 패턴으로 미리 정의된 규칙"
      >
        <CorrelationIcon color={COLORS.mint} frame={frame} />
      </Beat>

      <ThresholdSequenceScene frame={frame} startFrame={TS_START} duration={TS_DUR} />

      <StorageScene frame={frame} startFrame={STORE_START} duration={STORE_DUR} />

      <ClosingScene frame={frame} startFrame={CLOSE_START} duration={CLOSE_DUR} />
    </AbsoluteFill>
  );
}
