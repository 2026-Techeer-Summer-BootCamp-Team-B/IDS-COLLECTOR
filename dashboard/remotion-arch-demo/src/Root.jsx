import React from "react";
import { Composition } from "remotion";
import { ArchTreeDemo, FPS, WIDTH, HEIGHT, TOTAL_FRAMES } from "./MainVideo";
import {
  BreachPatternIntro,
  BREACH_FPS,
  BREACH_WIDTH,
  BREACH_HEIGHT,
  BREACH_TOTAL_FRAMES,
} from "./BreachPatternIntro";

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="ArchTreeDemo"
        component={ArchTreeDemo}
        durationInFrames={TOTAL_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      <Composition
        id="BreachPatternIntro"
        component={BreachPatternIntro}
        durationInFrames={BREACH_TOTAL_FRAMES}
        fps={BREACH_FPS}
        width={BREACH_WIDTH}
        height={BREACH_HEIGHT}
      />
    </>
  );
};
