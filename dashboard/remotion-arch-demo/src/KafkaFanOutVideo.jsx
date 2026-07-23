import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame } from "remotion";

// ---- 영상 스펙 ----
// Kafka 한 곳에서 시작한 로그 스트림이 ClickHouse / OpenSearch / PostgreSQL
// 세 갈래로 천천히 뻗어나가며, 각 저장소가 필요할 때 데이터를 가져다 쓸 수
// 있음을 보여주는 아키텍처 흐름 클립. 다른 컴포지션들과 같은 다크 네온
// 톤이며, 아이콘은 전부 인라인 SVG(외부 이미지·아이콘 파일 없음) - 이 프로젝트
// 전체가 이 방식을 쓰고 있고(ArchAnalogyVideo의 SearchBoxIcon/StatsBoxIcon/
// LockBoxIcon과 같은 계열), 이 컴포지션에서도 동일한 시각 언어를 재사용한다.
export const FLOW_FPS = 30;
export const FLOW_WIDTH = 1920;
export const FLOW_HEIGHT = 1080;
export const FLOW_TOTAL_FRAMES = 360; // 12초 - 모든 요소가 다 나온 뒤에도 데이터가 3~5초 더 흐르다 끝남

const COLORS = {
  bg: "#020203",
  bgDeep: "#0A0A0D",
  mint: "#00FFA6",
  amber: "#FFC423", // ClickHouse 실제 브랜드 톤(골드)에 맞춤
  clickhouseRed: "#FF3B30",
  cyan: "#3FD9FF", // OpenSearch 브랜드 블루/시안 계열
  violet: "#A78BFA",
  pgBlue: "#5B9DF0", // PostgreSQL 코끼리 마크의 블루 톤(네온 팔레트에 맞게 밝힘)
  line: "#4A5170",
  grid: "#2A3050",
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

function sr(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// 3차 베지어 곡선 위의 한 점을 직접 계산 (DOM 의존 없이 결정적으로 샘플링)
function bezierPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}

function buildPathSamples(p0, p1, p2, p3, n = 56) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    pts.push(bezierPoint(p0, p1, p2, p3, i / (n - 1)));
  }
  return pts;
}

// ---- 레이아웃 ----
const KAFKA_POS = [430, 540];
const TRUNK_JOINT = [900, 540]; // 세 경로가 공유하는 분기점 - 몸통이 갈라지는 것처럼 보이게

const DEST = {
  clickhouse: {
    pos: [1500, 260],
    color: COLORS.amber,
    label: "ClickHouse",
    sub: "통계 · 분석",
    ctrl2: [1150, 260],
  },
  opensearch: {
    pos: [1500, 540],
    color: COLORS.cyan,
    label: "OpenSearch",
    sub: "검색 · 대시보드",
    ctrl2: [1150, 540],
  },
  postgresql: {
    pos: [1500, 820],
    color: COLORS.pgBlue,
    label: "PostgreSQL",
    sub: "사건 상태 관리",
    ctrl2: [1150, 820],
  },
};

const PATH_START = [KAFKA_POS[0] + 95, KAFKA_POS[1]];

const PATHS = Object.fromEntries(
  Object.entries(DEST).map(([key, d]) => [
    key,
    buildPathSamples(PATH_START, TRUNK_JOINT, d.ctrl2, [d.pos[0] - 88, d.pos[1]]),
  ])
);

// =====================================================================
// 배경
// =====================================================================
function FlowBackground({ frame }) {
  const blobs = [
    { cx: 0.2, cy: 0.5, r: 480, color: COLORS.mint, fx: 0.0013, fy: 0.001, ph: 0 },
    { cx: 0.82, cy: 0.22, r: 380, color: COLORS.amber, fx: 0.0011, fy: 0.0015, ph: 1.7 },
    { cx: 0.82, cy: 0.8, r: 380, color: COLORS.pgBlue, fx: 0.0012, fy: 0.0013, ph: 3.1 },
  ];
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(circle, ${COLORS.line}22 1px, transparent 1px)`,
          backgroundSize: "50px 50px",
          opacity: 0.28,
        }}
      />
      {blobs.map((b, i) => {
        const x = (b.cx + Math.sin(frame * b.fx + b.ph) * 0.03) * FLOW_WIDTH;
        const y = (b.cy + Math.cos(frame * b.fy + b.ph) * 0.03) * FLOW_HEIGHT;
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
// 아이콘 - 전부 손으로 그린 인라인 SVG (외부 이미지 파일 다운로드는 이 환경
// 에서 불가능해서, 대신 각 기술의 실제 로고 마크를 참고해 그 특징적인
// 형태와 브랜드 톤을 살려 새로 그렸다: Kafka=노드-그래프 마크, ClickHouse=
// 세로 막대+레드 액센트, OpenSearch=소용돌이 마크, PostgreSQL=코끼리 얼굴).
// =====================================================================
function KafkaIcon({ size = 120, color, pulse = 0 }) {
  // 실제 Apache Kafka 로고 특유의 "동그란 노드들이 가지처럼 연결된" 형태를
  // 재해석 - 중심 노드에서 오른쪽으로 3단계 분기.
  const nodes = [
    { x: -30, y: 0, r: 10 }, // 중심
    { x: 4, y: -26, r: 8 },
    { x: 4, y: 26, r: 8 },
    { x: 36, y: -40, r: 6 },
    { x: 40, y: -8, r: 6 },
    { x: 40, y: 40, r: 6 },
  ];
  const edges = [
    [0, 1],
    [0, 2],
    [1, 3],
    [1, 4],
    [2, 5],
  ];
  return (
    <svg width={size} height={size} viewBox="-60 -60 120 120" style={{ overflow: "visible" }}>
      <circle cx={0} cy={0} r={52} fill="none" stroke={color} strokeWidth={2} opacity={0.16 + pulse * 0.22} />
      {edges.map(([a, b], i) => (
        <line
          key={i}
          x1={nodes[a].x}
          y1={nodes[a].y}
          x2={nodes[b].x}
          y2={nodes[b].y}
          stroke={color}
          strokeWidth={3.5}
          opacity={0.85}
        />
      ))}
      {nodes.map((n, i) => (
        <circle
          key={i}
          cx={n.x}
          cy={n.y}
          r={n.r}
          fill={COLORS.bgDeep}
          stroke={color}
          strokeWidth={5}
          style={{ filter: `drop-shadow(0 0 8px ${color})` }}
        />
      ))}
    </svg>
  );
}

function ClickHouseIcon({ size = 100, color }) {
  // 실제 ClickHouse 마크: 폭이 같은 세로 막대 여러 개 + 우하단의 붉은
  // 액센트 사각형.
  return (
    <svg width={size} height={size} viewBox="-50 -50 100 100" style={{ overflow: "visible" }}>
      <circle cx={0} cy={0} r={44} fill="none" stroke={color} strokeWidth={2} opacity={0.2} />
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={-32 + i * 15}
          y={-30}
          width={10}
          height={60}
          rx={2}
          fill={color}
          opacity={0.94}
          style={{ filter: `drop-shadow(0 0 8px ${color})` }}
        />
      ))}
      <rect x={28} y={22} width={10} height={10} rx={2} fill={COLORS.clickhouseRed} style={{ filter: `drop-shadow(0 0 8px ${COLORS.clickhouseRed})` }} />
    </svg>
  );
}

function OpenSearchIcon({ size = 100, color }) {
  // 실제 OpenSearch 마크: 한쪽 끝이 점처럼 맺히는 소용돌이(스윌) 형태.
  const gradId = "os-swirl-grad";
  return (
    <svg width={size} height={size} viewBox="-50 -50 100 100" style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="1" />
        </linearGradient>
      </defs>
      <circle cx={0} cy={0} r={44} fill="none" stroke={color} strokeWidth={2} opacity={0.2} />
      <path
        d="M 24 4 A 26 26 0 1 1 8 -22"
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={10}
        strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 10px ${color})` }}
      />
      <circle cx={8} cy={-22} r={5.5} fill={color} style={{ filter: `drop-shadow(0 0 8px ${color})` }} />
    </svg>
  );
}

function PostgresIcon({ size = 100, color }) {
  // 실제 PostgreSQL 마스코트 "슬로닉(코끼리)"을 단순화한 정면 얼굴 실루엣.
  return (
    <svg width={size} height={size} viewBox="-50 -50 100 100" style={{ overflow: "visible" }}>
      <circle cx={0} cy={0} r={44} fill="none" stroke={color} strokeWidth={2} opacity={0.2} />
      {/* 귀 */}
      <circle cx={-27} cy={-2} r={17} fill={COLORS.bgDeep} stroke={color} strokeWidth={5} opacity={0.9} />
      <circle cx={27} cy={-2} r={17} fill={COLORS.bgDeep} stroke={color} strokeWidth={5} opacity={0.9} />
      {/* 머리 */}
      <ellipse cx={0} cy={-6} rx={25} ry={22} fill={COLORS.bgDeep} stroke={color} strokeWidth={6} style={{ filter: `drop-shadow(0 0 10px ${color})` }} />
      {/* 코(트렁크) */}
      <path
        d="M -6 12 C -10 26, -2 34, 7 31 C 13 29, 11 22, 6 21"
        fill="none"
        stroke={color}
        strokeWidth={6}
        strokeLinecap="round"
      />
      {/* 눈 */}
      <circle cx={-9} cy={-10} r={3} fill={color} />
      <circle cx={9} cy={-10} r={3} fill={color} />
    </svg>
  );
}

const DEST_ICON = {
  clickhouse: ClickHouseIcon,
  opensearch: OpenSearchIcon,
  postgresql: PostgresIcon,
};

// =====================================================================
// 경로 선 - 점점 그려지는 폴리라인 (다른 컴포지션의 ChartLine과 같은 방식)
// =====================================================================
function PathLine({ samples, color, drawT }) {
  const revealCount = Math.max(2, Math.round(drawT * (samples.length - 1)) + 1);
  const visible = samples.slice(0, revealCount);
  const points = visible.map((p) => `${p[0]},${p[1]}`).join(" ");
  const tip = visible[visible.length - 1];
  const drawing = drawT > 0 && drawT < 1;

  return (
    <svg width={FLOW_WIDTH} height={FLOW_HEIGHT} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" opacity={0.55} />
      {drawing && (
        <circle cx={tip[0]} cy={tip[1]} r={6} fill={color} style={{ filter: `drop-shadow(0 0 10px ${color})` }} />
      )}
    </svg>
  );
}

// 경로를 따라 천천히 흐르는 데이터 입자들 - 개수만큼 위상을 나눠 끊김 없이
// 이어지는 스트림처럼 보이게 한다.
function FlowParticles({ frame, samples, color, loopStart, loopFrames, count = 3 }) {
  const local = frame - loopStart;
  if (local < 0) return null;
  const n = samples.length;

  const dots = [];
  for (let i = 0; i < count; i++) {
    const phase = i / count;
    const raw = (local / loopFrames + phase) % 1;
    const idx = Math.min(n - 1, Math.floor(raw * (n - 1)));
    const p = samples[idx];
    // 경로 양 끝에서 부드럽게 나타나고 사라지게
    const edgeFade = Math.min(raw / 0.06, 1, (1 - raw) / 0.06, 1);
    dots.push({ p, opacity: clamp01(edgeFade) });
  }

  return (
    <svg width={FLOW_WIDTH} height={FLOW_HEIGHT} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
      {dots.map((d, i) => (
        <g key={i}>
          <circle cx={d.p[0]} cy={d.p[1]} r={9} fill={color} opacity={d.opacity} style={{ filter: `drop-shadow(0 0 12px ${color})` }} />
          <circle cx={d.p[0]} cy={d.p[1]} r={15} fill="none" stroke={color} strokeWidth={1.5} opacity={d.opacity * 0.4} />
        </g>
      ))}
    </svg>
  );
}

// =====================================================================
// 메인 컴포지션
// =====================================================================
export function KafkaFanOutVideo() {
  const frame = useCurrentFrame();

  const introP = progressBetween(frame, 0, 18);
  const kafkaPop = spring({ frame: frame - 6, fps: FLOW_FPS, config: { damping: 15, mass: 0.7, stiffness: 130 } });

  const DRAW_START = 44;
  const DRAW_FRAMES = 78;
  const drawT = progressBetween(frame, DRAW_START, DRAW_START + DRAW_FRAMES);

  const PARTICLE_LOOP_START = DRAW_START + DRAW_FRAMES - 6;
  const PARTICLE_LOOP_FRAMES = 118;

  const captionP = progressBetween(frame, 150, 172);
  const subCaptionP = progressBetween(frame, 178, 200);

  // 캡션까지 다 나온 뒤(약 200프레임)에도 데이터가 3~5초 더 흐르다가 마지막
  // 15프레임에서만 부드럽게 페이드아웃.
  const blackoutP = progressBetween(frame, FLOW_TOTAL_FRAMES - 15, FLOW_TOTAL_FRAMES);

  return (
    <AbsoluteFill style={{ fontFamily: SANS }}>
      <FlowBackground frame={frame} />

      <AbsoluteFill style={{ opacity: clamp01(introP) }}>
        {/* 타이틀 */}
        <div style={{ position: "absolute", left: 130, top: 90 }}>
          <p style={{ color: COLORS.text, fontSize: 30, fontWeight: 700, margin: 0, letterSpacing: 0.5 }}>
            하나의 로그 스트림, 세 갈래로 흐릅니다
          </p>
          <p style={{ color: COLORS.textDim, fontSize: 17, margin: "8px 0 0", fontFamily: MONO }}>
            Kafka → ClickHouse / OpenSearch / PostgreSQL
          </p>
        </div>

        {/* 경로 3개 - 뒤로 깔림 */}
        {Object.entries(DEST).map(([key, d]) => (
          <PathLine key={key} samples={PATHS[key]} color={d.color} drawT={drawT} />
        ))}

        {/* 흐르는 데이터 입자 3개 경로 */}
        {Object.entries(DEST).map(([key, d]) => (
          <FlowParticles
            key={key}
            frame={frame}
            samples={PATHS[key]}
            color={d.color}
            loopStart={PARTICLE_LOOP_START}
            loopFrames={PARTICLE_LOOP_FRAMES}
            count={3}
          />
        ))}

        {/* Kafka 노드 */}
        <div
          style={{
            position: "absolute",
            left: KAFKA_POS[0] - 70,
            top: KAFKA_POS[1] - 70,
            width: 140,
            textAlign: "center",
            opacity: clamp01(kafkaPop),
            transform: `scale(${interpolate(kafkaPop, [0, 1], [0.6, 1])})`,
          }}
        >
          <KafkaIcon size={130} color={COLORS.mint} pulse={0.5 + 0.5 * Math.sin(frame * 0.08)} />
          <p style={{ color: COLORS.mint, fontSize: 22, fontWeight: 700, margin: "14px 0 0", textShadow: `0 0 14px ${COLORS.mint}` }}>
            Kafka
          </p>
          <p style={{ color: COLORS.textDim, fontSize: 14, margin: "2px 0 0" }}>실시간 로그 스트림</p>
        </div>

        {/* 세 저장소 */}
        {Object.entries(DEST).map(([key, d]) => {
          const Icon = DEST_ICON[key];
          const arriveFrame = DRAW_START + DRAW_FRAMES - 8;
          const pop = spring({ frame: frame - arriveFrame, fps: FLOW_FPS, config: { damping: 14, mass: 0.7, stiffness: 140 } });
          const breathe = 0.55 + 0.45 * Math.sin(frame * 0.045 + d.pos[1] * 0.01);
          const activeGlow = frame > arriveFrame ? breathe : 0;
          return (
            <div
              key={key}
              style={{
                position: "absolute",
                left: d.pos[0] - 60,
                top: d.pos[1] - 60,
                width: 260,
                opacity: clamp01(pop),
                transform: `scale(${interpolate(pop, [0, 1], [0.6, 1])})`,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: -20,
                  top: -20,
                  width: 160,
                  height: 160,
                  borderRadius: "50%",
                  background: `radial-gradient(circle, ${d.color}${Math.round(activeGlow * 26).toString(16).padStart(2, "0")} 0%, ${d.color}00 70%)`,
                }}
              />
              <Icon size={110} color={d.color} />
              <div style={{ position: "absolute", left: 128, top: 14, whiteSpace: "nowrap" }}>
                <p style={{ color: d.color, fontSize: 22, fontWeight: 700, margin: 0, textShadow: `0 0 12px ${d.color}` }}>{d.label}</p>
                <p style={{ color: COLORS.textDim, fontSize: 14, margin: "3px 0 0" }}>{d.sub}</p>
              </div>
            </div>
          );
        })}

        {/* 하단 캡션 */}
        <div style={{ position: "absolute", left: 130, bottom: 96, opacity: clamp01(captionP) }}>
          <p style={{ color: COLORS.text, fontSize: 26, fontWeight: 700, margin: 0 }}>
            같은 로그가 목적에 맞는 저장소로 동시에 전달되고,
          </p>
        </div>
        <div style={{ position: "absolute", left: 130, bottom: 60, opacity: clamp01(subCaptionP) }}>
          <p style={{ color: COLORS.mint, fontSize: 26, fontWeight: 700, margin: 0, textShadow: `0 0 14px ${COLORS.mint}` }}>
            필요한 순간, 필요한 곳에서 즉시 조회됩니다.
          </p>
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{ backgroundColor: "#000000", opacity: blackoutP }} />
    </AbsoluteFill>
  );
}
