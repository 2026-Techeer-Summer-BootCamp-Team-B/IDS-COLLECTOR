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

// 스토리 순서: 로그인 -> 검색 -> ATT&CK(확인 -> 조치 이동) ->
// Incident(스토리 확인 -> 조사 시작 -> 조치 완료) -> GeoIP.
// public/에 저장된 스크린샷 파일명을 그대로 참조한다(공백/& 포함, 대소문자 주의).
// fullBleed: true인 장면은 카드 프레임 없이 화면 전체를 채운다(로그인 페이지처럼
// 그 자체로 이미 완성된 화면일 때).
const SCENES = [
  { key: "login", caption: "로그인", file: "1. login.png", fullBleed: true },
  { key: "search", caption: "검색창으로 바로 로그 검색", file: "search.png" },
  { key: "attack-overview", caption: "들어오는 공격 확인", file: "att&ck .png" },
  { key: "attack-action", caption: "조치하러 바로 이동", file: "att&zoom.png", emphasize: true },
  { key: "incident-story", caption: "공격 스토리라인 확인", file: "incident.png" },
  { key: "incident-investigate", caption: "조사 시작", file: "incident2.png", emphasize: true },
  { key: "incident-resolve", caption: "조치 완료", file: "incident3.png", emphasize: true },
  { key: "geoip", caption: "공격 발원지 확인", file: "geoip.png" },
];

// 장면당 길이 - 필요하면 이 숫자만 바꾸면 전체 길이가 같이 조정된다.
const SCENE_DURATION_SEC = 2.5;
const SCENE_DURATION_FRAMES = Math.round(SCENE_DURATION_SEC * FPS); // 75프레임
export const TOTAL_FRAMES = SCENE_DURATION_FRAMES * SCENES.length; // 600프레임 = 20초

const BEZEL_BG = "#050607";

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
  // 버튼/상세 강조용 클로즈업 컷은 조금 더 강하게 줌인해서 "확대해서 보여준다"는
  // 느낌을 살린다.
  const zoomTo = scene.emphasize ? 1.08 : 1.04;
  const scale = interpolate(frame, [0, SCENE_DURATION_FRAMES], [1, zoomTo], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: BEZEL_BG, opacity }}>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: scene.fullBleed ? 0 : "64px 90px 118px",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            transform: `scale(${scale})`,
            transformOrigin: "center",
            borderRadius: scene.fullBleed ? 0 : 14,
            overflow: "hidden",
            border: scene.fullBleed ? "none" : "1px solid rgba(255,255,255,0.1)",
            boxShadow: scene.fullBleed ? "none" : "0 20px 60px rgba(0,0,0,0.6)",
          }}
        >
          <Img
            src={staticFile(scene.file)}
            style={{ width: "100%", height: "100%", objectFit: scene.fullBleed ? "cover" : "contain" }}
          />
        </div>
      </AbsoluteFill>

      {/* 하단 자막 - 화면이 바뀔 때마다 지금 무엇을 보여주는지 설명한다 */}
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 34 }}>
        <div
          style={{
            opacity: fadeIn,
            background: "rgba(5,6,7,0.72)",
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: 999,
            padding: "10px 24px",
            color: "#fff",
            fontSize: 21,
            fontWeight: 500,
            fontFamily: "sans-serif",
            letterSpacing: 0.1,
          }}
        >
          {scene.caption}
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

export function IntroDemo() {
  return (
    <AbsoluteFill style={{ backgroundColor: BEZEL_BG }}>
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
