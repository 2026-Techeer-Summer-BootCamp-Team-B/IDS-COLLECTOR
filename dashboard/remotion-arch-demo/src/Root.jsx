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
import {
  ArchAnalogyVideo,
  ARCH_FPS,
  ARCH_WIDTH,
  ARCH_HEIGHT,
  ARCH_TOTAL_FRAMES,
} from "./ArchAnalogyVideo";
import {
  HackerTypingIntro,
  HACK_FPS,
  HACK_WIDTH,
  HACK_HEIGHT,
  HACK_TOTAL_FRAMES,
} from "./HackerTypingIntro";
import {
  BreachVsPopulationChart,
  CHART_FPS,
  CHART_WIDTH,
  CHART_HEIGHT,
  CHART_TOTAL_FRAMES,
} from "./BreachVsPopulationChart";
import {
  KafkaFanOutVideo,
  FLOW_FPS,
  FLOW_WIDTH,
  FLOW_HEIGHT,
  FLOW_TOTAL_FRAMES,
} from "./KafkaFanOutVideo";
import {
  OtelBridgeVideo,
  OTEL_FPS,
  OTEL_WIDTH,
  OTEL_HEIGHT,
  OTEL_TOTAL_FRAMES,
} from "./OtelBridgeVideo";
import {
  ReferenceFlashVideo,
  REF_FPS,
  REF_WIDTH,
  REF_HEIGHT,
  REF_TOTAL_FRAMES,
} from "./ReferenceFlashVideo";
import {
  LogPassthroughVideo,
  RAIN_FPS,
  RAIN_WIDTH,
  RAIN_HEIGHT,
  RAIN_TOTAL_FRAMES,
} from "./LogPassthroughVideo";

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
      <Composition
        id="ArchAnalogyVideo"
        component={ArchAnalogyVideo}
        durationInFrames={ARCH_TOTAL_FRAMES}
        fps={ARCH_FPS}
        width={ARCH_WIDTH}
        height={ARCH_HEIGHT}
      />
      <Composition
        id="HackerTypingIntro"
        component={HackerTypingIntro}
        durationInFrames={HACK_TOTAL_FRAMES}
        fps={HACK_FPS}
        width={HACK_WIDTH}
        height={HACK_HEIGHT}
      />
      <Composition
        id="BreachVsPopulationChart"
        component={BreachVsPopulationChart}
        durationInFrames={CHART_TOTAL_FRAMES}
        fps={CHART_FPS}
        width={CHART_WIDTH}
        height={CHART_HEIGHT}
      />
      <Composition
        id="KafkaFanOutVideo"
        component={KafkaFanOutVideo}
        durationInFrames={FLOW_TOTAL_FRAMES}
        fps={FLOW_FPS}
        width={FLOW_WIDTH}
        height={FLOW_HEIGHT}
      />
      <Composition
        id="OtelBridgeVideo"
        component={OtelBridgeVideo}
        durationInFrames={OTEL_TOTAL_FRAMES}
        fps={OTEL_FPS}
        width={OTEL_WIDTH}
        height={OTEL_HEIGHT}
      />
      <Composition
        id="ReferenceFlashVideo"
        component={ReferenceFlashVideo}
        durationInFrames={REF_TOTAL_FRAMES}
        fps={REF_FPS}
        width={REF_WIDTH}
        height={REF_HEIGHT}
      />
      <Composition
        id="LogPassthroughVideo"
        component={LogPassthroughVideo}
        durationInFrames={RAIN_TOTAL_FRAMES}
        fps={RAIN_FPS}
        width={RAIN_WIDTH}
        height={RAIN_HEIGHT}
      />
    </>
  );
};
