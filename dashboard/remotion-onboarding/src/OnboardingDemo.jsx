import React from "react";
import {
  AbsoluteFill,
  Series,
  Img,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";

// 컴포지션 기본값 - Root.jsx의 <Composition>과 값을 맞춰야 한다.
export const FPS = 30;
export const WIDTH = 1280;
export const HEIGHT = 720;

// 화면 순서대로(Overview → Incidents → ATT&CK → Infrastructure) 블랙 -> 화이트로
// 진행. public/에 저장된 스크린샷 파일명을 그대로 참조한다(공백/& 포함, 대소문자 주의).
// admin 페이지는 스크린샷을 찍지 않았으므로 목록에서 제외했다.
const SCENES = [
  { key: "overview-dark", label: "Overview", theme: "Dark", file: "overview black.png" },
  { key: "overview-light", label: "Overview", theme: "Light", file: "overview white.png" },
  { key: "incidents-dark", label: "Incidents", theme: "Dark", file: "incident black.png" },
  { key: "incidents-light", label: "Incidents", theme: "Light", file: "incident white.png" },
  { key: "attack-dark", label: "ATT&CK", theme: "Dark", file: "ATT&CK black.png" },
  { key: "attack-light", label: "ATT&CK", theme: "Light", file: "ATT&CK white.png" },
  { key: "infra-dark", label: "Infrastructure", theme: "Dark", file: "Infrastructure black.png" },
  { key: "infra-light", label: "Infrastructure", theme: "Light", file: "Infrastructure white.png" },
];

// 장면당 길이 - 필요하면 이 숫자만 바꾸면 전체 길이가 같이 조정된다.
const SCENE_DURATION_SEC = 2.5;
const SCENE_DURATION_FRAMES = Math.round(SCENE_DURATION_SEC * FPS); // 75프레임
export const TOTAL_FRAMES = SCENE_DURATION_FRAMES * SCENES.length; // 600프레임 = 20초

function Scene({ scene }) {
  const frame = useCurrentFrame();

  // 페이드 인/아웃 (앞뒤 12프레임 = 0.4초)
  const fadeIn = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(
    frame,
    [SCENE_DURATION_FRAMES - 12, SCENE_DURATION_FRAMES],
    [1, 0],
    { extrapolateLeft: "clamp" }
  );
  const opacity = Math.min(fadeIn, fadeOut);

  // 정지 스크린샷이라 움직임이 없으면 밋밋해서, 은은한 켄번즈 줌을 준다.
  const scale = interpolate(frame, [0, SCENE_DURATION_FRAMES], [1, 1.03], {
    extrapolateRight: "clamp",
  });

  const isDark = scene.theme === "Dark";
  // 자막 문구: "Overview black theme" / "Overview white theme" 형태 (첫 글자만 대문자)
  const caption = `${scene.label} ${isDark ? "black" : "white"} theme`;

  return (
    <AbsoluteFill style={{ backgroundColor: isDark ? "#000" : "#fff", opacity }}>
      {/* 스크린샷이 잘리지 않도록 objectFit: contain + 여백을 둬서 화면 전체가
          한 프레임 안에 다 들어오게 한다(예전 cover 방식은 프레임보다 넓은
          스크린샷 좌우가 잘려나갔다). 여백 덕분에 이미지 자체도 더 작아 보인다. */}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: "70px 90px 120px",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            transform: `scale(${scale})`,
            transformOrigin: "center",
            borderRadius: 14,
            overflow: "hidden",
            border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)"}`,
            boxShadow: isDark
              ? "0 20px 60px rgba(0,0,0,0.5)"
              : "0 20px 60px rgba(0,0,0,0.18)",
          }}
        >
          <Img
            src={staticFile(scene.file)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              translate: "11.9px 3.2px"
            }}
            from={-12} />
        </div>
      </AbsoluteFill>
      {/* 하단 자막 - 화면이 바뀔 때마다 어떤 화면/테마인지 보여준다 */}
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 34 }}>
        <div
          style={{
            opacity: fadeIn,
            background: isDark ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.85)",
            border: `1px solid ${isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)"}`,
            borderRadius: 999,
            padding: "10px 22px",
            color: isDark ? "#fff" : "#111",
            fontSize: 20,
            fontWeight: 500,
            fontFamily: "sans-serif",
            letterSpacing: 0.2,
          }}
        >
          {caption}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function ProgressBar() {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const pct = (frame / durationInFrames) * 100;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end" }}>
      <div style={{ height: 3, width: "100%", background: "rgba(255,255,255,0.15)" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: "#fff" }} />
      </div>
    </AbsoluteFill>
  );
}

export function OnboardingDemo() {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <Series>
        {SCENES.map((scene) => (
          <Series.Sequence key={scene.key} durationInFrames={SCENE_DURATION_FRAMES}>
            <Scene scene={scene} />
          </Series.Sequence>
        ))}
      </Series>
      <ProgressBar />
    </AbsoluteFill>
  );
}
