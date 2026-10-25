import React from "react";
import { Composition } from "remotion";
import { TurniaVideo, TOTAL } from "./turnia/Video";

const FPS = 30;
export const Root: React.FC = () => (
  <>
    <Composition id="turnia-horizontal" component={TurniaVideo} durationInFrames={TOTAL} fps={FPS} width={1920} height={1080} />
    <Composition id="turnia-vertical" component={TurniaVideo} durationInFrames={TOTAL} fps={FPS} width={1080} height={1920} />
  </>
);
