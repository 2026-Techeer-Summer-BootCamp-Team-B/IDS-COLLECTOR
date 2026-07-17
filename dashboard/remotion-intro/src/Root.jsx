import React from "react";
import { Composition } from "remotion";
import { IntroDemo, FPS, WIDTH, HEIGHT, TOTAL_FRAMES } from "./IntroDemo";

export const RemotionRoot = () => {
  return (
    <Composition
      id="IntroDemo"
      component={IntroDemo}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  );
};
