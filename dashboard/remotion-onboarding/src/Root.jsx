import React from "react";
import { Composition } from "remotion";
import { OnboardingDemo, FPS, WIDTH, HEIGHT, TOTAL_FRAMES } from "./OnboardingDemo";
import {
  DualMonitorTour,
  FPS as TOUR_FPS,
  WIDTH as TOUR_WIDTH,
  HEIGHT as TOUR_HEIGHT,
  TOTAL_FRAMES as TOUR_TOTAL_FRAMES,
} from "./DualMonitorTour";

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="OnboardingDemo"
        component={OnboardingDemo}
        durationInFrames={TOTAL_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      {/* 2026-07-17: "화면 두 대(블랙/화이트)를 동시에 보여주며 아래로 스크롤해
          다음 화면으로 넘어가는" 새 소개 영상 - 로그인용 OnboardingDemo와는
          별개 컴포지션이라 기존 것을 건드리지 않는다. */}
      <Composition
        id="DualMonitorTour"
        component={DualMonitorTour}
        durationInFrames={TOUR_TOTAL_FRAMES}
        fps={TOUR_FPS}
        width={TOUR_WIDTH}
        height={TOUR_HEIGHT}
      />
    </>
  );
};
