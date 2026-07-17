import React from "react";
import { Composition } from "remotion";
import { ArchTreeDemo, FPS, WIDTH, HEIGHT, TOTAL_FRAMES } from "./MainVideo";

export const RemotionRoot = () => {
  return (
    <Composition
      id="ArchTreeDemo"
      component={ArchTreeDemo}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  );
};
