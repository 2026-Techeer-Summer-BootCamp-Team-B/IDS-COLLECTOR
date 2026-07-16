import React from "react";
import { Composition } from "remotion";
import { OnboardingDemo, FPS, WIDTH, HEIGHT, TOTAL_FRAMES } from "./OnboardingDemo";

export const RemotionRoot = () => {
  return (
    <Composition
      id="OnboardingDemo"
      component={OnboardingDemo}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  );
};
