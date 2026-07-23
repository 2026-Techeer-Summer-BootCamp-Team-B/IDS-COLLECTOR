import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame } from "remotion";

// ---- 영상 스펙 ----
// KISA 홍보영상 썸네일("해커가 기업 정보 탈취하는 방법") 참고해서 만든 짧은
// 위협 몽타주 클립. 실제 인물 사진은 재현할 수 없어서 후드 실루엣(라인아트)
// + 빠르게 채워지는 터미널 코드 오버레이로 재해석했다. BreachPatternIntro/
// ArchAnalogyVideo와 같은 톤(다크 네온, CSS/SVG only, Noto Sans KR)을 그대로
// 따르되 완전히 새로운 별도 컴포지션 - SENTINEL-OPS 브랜딩은 넣지 않는다
// (이건 "위협" 파트라 제품 리빌은 다른 영상이 담당).
export const HACK_FPS = 30;
export const HACK_WIDTH = 1920;
export const HACK_HEIGHT = 1080;
export const HACK_TOTAL_FRAMES = 150; // 5초

const COLORS = {
  bg: "#020203",
  bgDeep: "#0A0A0D",
  mint: "#00FFA6",
  critical: "#FF1F4B",
  cyan: "#3FD9FF",
  line: "#4A5170",
  text: "#DCE6FF",
  textDim: "#7A8AB0",
  textDimmer: "#4E5A78",
};

const MONO = "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const SANS = "'Noto Sans KR', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const clamp01 = (v) => Math.min(1, Math.max(0, v));

function progressBetween(frame, start, end) {
  if (end <= start) return frame >= end ? 1 : 0;
  return interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

// 결정적 pseudo-random (BreachPatternIntro와 동일한 관습) - 매 프레임 다른
// Math.random() 대신 시드 기반으로 렌더마다 같은 결과가 나오게 한다.
function sr(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// =====================================================================
// 배경: 다른 두 영상보다 더 무겁고 위협적인 톤 - 민트 대신 critical red를
// 섞고, 격자를 더 흐리게 해서 "아직 우리가 등장하기 전" 느낌을 준다.
// =====================================================================
function ThreatBackground({ frame = 0 }) {
  const blobs = [
    { cx: 0.18, cy: 0.3, r: 460, color: COLORS.critical, fx: 0.0016, fy: 0.0013, ph: 0 },
    { cx: 0.82, cy: 0.72, r: 420, color: COLORS.cyan, fx: 0.0014, fy: 0.0019, ph: 3.1 },
  ];
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(circle, ${COLORS.line}22 1px, transparent 1px)`,
          backgroundSize: "52px 52px",
          opacity: 0.25,
        }}
      />
      {blobs.map((b, i) => {
        const x = (b.cx + Math.sin(frame * b.fx + b.ph) * 0.04) * HACK_WIDTH;
        const y = (b.cy + Math.cos(frame * b.fy + b.ph) * 0.04) * HACK_HEIGHT;
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
              background: `radial-gradient(circle, ${b.color}14 0%, ${b.color}00 70%)`,
            }}
          />
        );
      })}
      {/* 화면 가장자리를 강하게 죽여서 참고 이미지의 "단일 광원" 느낌을 흉내 */}
      <AbsoluteFill
        style={{ background: `radial-gradient(ellipse at 32% 62%, ${COLORS.bg}00 0%, #000000e6 78%)` }}
      />
    </AbsoluteFill>
  );
}

// =====================================================================
// 후드 실루엣 + 노트북 (전부 SVG 라인아트, 사진 아님)
// 참고 이미지(정면에서 노트북 뒤에 앉아있는 후드 인물)의 구도를 따라 좌우
// 대칭인 정면 실루엣으로 다시 그렸다 - 이전 버전은 뒤/옆에서 본 각도라 팔
// 라인이 부자연스러워 보였다는 피드백을 반영. 손은 노트북 뒤에 가려 안
// 보이므로 별도로 그리지 않는다(참고 이미지와 동일). 배경과 어울리게
// 실루엣 톤을 훨씬 어둡게 낮추고, 빛은 노트북 힌지 쪽에서 아주 얇게만
// 새어나오는 정도로 줄였다.
function HoodedFigure({ frame, glowP }) {
  const bob = Math.sin(frame * 0.18) * 1.6;

  return (
    <svg width={620} height={660} viewBox="-310 -330 620 660" style={{ overflow: "visible" }}>
      {/* 책상 */}
      <rect x={-260} y={230} width={520} height={14} rx={4} fill="#040405" stroke={COLORS.line} strokeWidth={1.2} opacity={0.55} />

      <g transform={`translate(0, ${bob})`}>
        {/* 어깨/몸통 - 좌우 대칭 (정면) */}
        <path
          d="M -168 230 C -168 70 -138 -10 -54 -34 L 54 -34 C 138 -10 168 70 168 230 Z"
          fill="#020203"
        />
        {/* 후드 머리 - 좌우 대칭, 완전히 얼굴을 가림 */}
        <path
          d="M -88 -34 C -92 -160 -50 -240 0 -240 C 50 -240 92 -160 88 -34 C 88 4 46 26 0 26 C -46 26 -88 4 -88 -34 Z"
          fill="#020203"
        />
        {/* 은은한 림 라이트 - 정수리~어깨선 가장자리에만 아주 옅게 */}
        <path
          d="M -88 -34 C -92 -160 -50 -240 0 -240 C 50 -240 92 -160 88 -34"
          fill="none"
          stroke={COLORS.cyan}
          strokeWidth={1.5}
          opacity={0.16}
        />
        <path d="M -168 230 C -168 70 -138 -10 -54 -34" fill="none" stroke={COLORS.cyan} strokeWidth={1} opacity={0.1} />
        <path d="M 168 230 C 168 70 138 -10 54 -34" fill="none" stroke={COLORS.cyan} strokeWidth={1} opacity={0.1} />
      </g>

      {/* 노트북 본체 (뒤에서 본 모습 - 화면 뒷면이 인물을, 힌지 쪽 빛이 살짝만 관객 쪽으로) */}
      <g transform="translate(0, 156)">
        <rect x={-150} y={30} width={300} height={14} rx={4} fill="#0A0B0E" stroke={COLORS.line} strokeWidth={1.2} />
        <path
          d="M -134 30 L -112 -122 L 112 -122 L 134 30 Z"
          fill="#111318"
          stroke="#2A2E3A"
          strokeWidth={1.5}
        />
        <path d="M -134 30 L -112 -122 L 112 -122 L 134 30" fill="none" stroke={COLORS.line} strokeWidth={1} opacity={0.5} />
        {/* 힌지에서 아주 얇게 새어나오는 빛줄기 하나 - 유일한 광원 */}
        <rect x={-96} y={26} width={192} height={3} fill={COLORS.cyan} opacity={0.5 * glowP} style={{ filter: `blur(3px)` }} />
      </g>
    </svg>
  );
}

// =====================================================================
// 매트릭스 코드 비 - 참고 이미지 배경의 세로 문자열 느낌을 사진 없이
// 재현. 아주 옅게 깔아서 우측 터미널 패널(진짜 보여줄 내용)을 방해하지
// 않게 한다.
// =====================================================================
const RAIN_WORDS = ["HACKER", "PASSWORD", "DATA", "SECURITY", "INTERNET", "BREACH", "01001", "10110", "ACCESS"];
const RAIN_COLUMNS = 26;
const RAIN_ROWS = 16;

function MatrixRain({ frame }) {
  const cellH = 26;
  return (
    <AbsoluteFill style={{ opacity: 0.14, overflow: "hidden" }}>
      {Array.from({ length: RAIN_COLUMNS }).map((_, col) => {
        const colSeed = col * 71.3;
        const speed = 0.6 + sr(colSeed) * 0.9;
        const word = RAIN_WORDS[Math.floor(sr(colSeed + 4) * RAIN_WORDS.length) % RAIN_WORDS.length];
        const x = (col / RAIN_COLUMNS) * HACK_WIDTH + sr(colSeed + 9) * 20;
        const offset = ((frame * speed + sr(colSeed) * 4000) % (RAIN_ROWS * cellH * 2)) - RAIN_ROWS * cellH;
        return (
          <div key={col} style={{ position: "absolute", left: x, top: 0, fontFamily: MONO, fontSize: 15, fontWeight: 600 }}>
            {word.split("").map((ch, row) => (
              <div
                key={row}
                style={{
                  position: "absolute",
                  top: offset + row * cellH,
                  color: row === 0 ? COLORS.cyan : COLORS.textDimmer,
                  opacity: row === 0 ? 0.9 : Math.max(0, 0.55 - row * 0.06),
                }}
              >
                {ch}
              </div>
            ))}
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

// =====================================================================
// 터미널 코드 오버레이 - 완전히 지어낸(동작하지 않는) 더미 로그 텍스트라
// 실제 취약점/명령어가 아니다. "해커 영화"식 연출용.
// =====================================================================
const CODE_LINES = [
  "root@relay:~$ nmap -sV -p- target",
  "scanning 65535 ports ...",
  "[+] service found: ssh (22)",
  "[+] service found: http (8080)",
  "root@relay:~$ curl -s target/api/session",
  '{"token":"a91f..e02b","role":"guest"}',
  "[*] brute-forcing session token",
  "attempt 8214/9999 ............ FAIL",
  "attempt 8215/9999 ............ FAIL",
  "attempt 8216/9999 ............ OK",
  "[+] privilege escalated -> admin",
  "root@relay:~$ GET /internal/export",
  "streaming dump.sql (482,204 rows)",
  "[#####################] 100%",
  "root@relay:~$ whoami",
  "system-admin (uid=0)",
  "[!] exfiltration channel opened",
];

function TerminalPanel({ frame }) {
  const startDelay = 6;
  const framesPerLine = 7;
  const local = Math.max(0, frame - startDelay);
  const linesTyped = Math.floor(local / framesPerLine);
  const visibleRows = 14;
  const startIdx = Math.max(0, linesTyped - visibleRows + 1);
  const rows = [];
  for (let i = startIdx; i <= linesTyped; i++) {
    const text = CODE_LINES[i % CODE_LINES.length];
    const isLast = i === linesTyped;
    let shown = text;
    if (isLast) {
      const t = local - i * framesPerLine;
      const chars = Math.min(text.length, Math.max(0, Math.floor((t / framesPerLine) * text.length * 1.6)));
      shown = text.slice(0, chars);
    }
    const tone =
      text.startsWith("[+]") ? COLORS.mint : text.startsWith("[!]") ? COLORS.critical : text.startsWith("[*]") ? COLORS.cyan : COLORS.textDim;
    rows.push({ key: i, shown, tone, isLast });
  }

  const cursorOn = Math.floor(frame / 6) % 2 === 0;

  return (
    <div
      style={{
        position: "absolute",
        right: 90,
        top: 130,
        bottom: 130,
        width: 760,
        borderRadius: 14,
        border: `1px solid ${COLORS.cyan}44`,
        background: "linear-gradient(180deg, #060608f0, #030304f5)",
        boxShadow: `0 0 60px ${COLORS.cyan}22, inset 0 0 40px #00000090`,
        padding: "26px 30px",
        overflow: "hidden",
        fontFamily: MONO,
      }}
    >
      <div style={{ display: "flex", gap: 8, marginBottom: 16, opacity: 0.7 }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: COLORS.critical, display: "inline-block" }} />
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#F5E400", display: "inline-block" }} />
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: COLORS.mint, display: "inline-block" }} />
      </div>
      {rows.map((r) => (
        <div
          key={r.key}
          style={{
            color: r.tone,
            fontSize: 20,
            lineHeight: "30px",
            whiteSpace: "pre",
            opacity: r.isLast ? 1 : 0.82,
          }}
        >
          {r.shown}
          {r.isLast && cursorOn ? <span style={{ background: COLORS.text, opacity: 0.9 }}>&nbsp;</span> : null}
        </div>
      ))}
    </div>
  );
}

// 아주 짧은 글리치(RGB 분리 느낌) - 프레임 몇 개만 트리거
function useGlitch(frame, triggers) {
  for (const t of triggers) {
    if (frame >= t && frame < t + 3) return clamp01((t + 3 - frame) / 3);
  }
  return 0;
}

// =====================================================================
// 메인 컴포지션
// =====================================================================
export function HackerTypingIntro() {
  const frame = useCurrentFrame();

  const introP = progressBetween(frame, 0, 14);
  const glowP = spring({ frame: frame - 8, fps: HACK_FPS, config: { damping: 200 } });
  const glitch = useGlitch(frame, [38, 84]);

  // 엔딩 - 마지막 20프레임에 "ACCESS GRANTED" 강조 후 블랙아웃
  const END_START = HACK_TOTAL_FRAMES - 22;
  const endP = progressBetween(frame, END_START, END_START + 10);
  const endPop = spring({ frame: frame - END_START, fps: HACK_FPS, config: { damping: 12, stiffness: 180 } });
  const blackoutP = progressBetween(frame, HACK_TOTAL_FRAMES - 8, HACK_TOTAL_FRAMES);

  const shakeX = glitch > 0 ? (sr(frame) - 0.5) * 14 * glitch : 0;

  return (
    <AbsoluteFill style={{ fontFamily: SANS }}>
      <ThreatBackground frame={frame} />
      <MatrixRain frame={frame} />

      <AbsoluteFill
        style={{
          opacity: clamp01(introP),
          transform: `scale(${interpolate(introP, [0, 1], [1.03, 1])}) translateX(${shakeX}px)`,
        }}
      >
        {/* 좌측: 후드 인물 (정면, 노트북 뒤에 앉은 구도) */}
        <div style={{ position: "absolute", left: 60, bottom: -50 }}>
          <HoodedFigure frame={frame} glowP={glowP} />
        </div>

        {/* 우측: 터미널 코드 오버레이 */}
        <TerminalPanel frame={frame} />
      </AbsoluteFill>

      {/* 글리치 스캔라인 플래시 */}
      {glitch > 0 && (
        <AbsoluteFill
          style={{
            background: `repeating-linear-gradient(0deg, ${COLORS.cyan}22 0px, transparent 2px, transparent 4px)`,
            opacity: glitch * 0.5,
            mixBlendMode: "screen",
          }}
        />
      )}

      {/* 엔딩: ACCESS GRANTED */}
      {frame >= END_START && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <div
            style={{
              opacity: clamp01(endP),
              transform: `scale(${interpolate(endPop, [0, 1], [0.85, 1])})`,
              padding: "22px 46px",
              border: `2px solid ${COLORS.critical}`,
              borderRadius: 10,
              background: "#000000cc",
              boxShadow: `0 0 60px ${COLORS.critical}80`,
            }}
          >
            <span
              style={{
                fontFamily: MONO,
                fontSize: 46,
                fontWeight: 700,
                letterSpacing: 4,
                color: COLORS.critical,
                textShadow: `0 0 24px ${COLORS.critical}`,
              }}
            >
              ACCESS GRANTED
            </span>
          </div>
        </AbsoluteFill>
      )}

      {/* 블랙아웃 - 다음 영상/슬라이드로 넘어가기 위한 하드컷 준비 */}
      <AbsoluteFill style={{ backgroundColor: "#000000", opacity: blackoutP }} />
    </AbsoluteFill>
  );
}
