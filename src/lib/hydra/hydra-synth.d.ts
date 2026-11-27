declare module "hydra-synth" {
  interface HydraOptions {
    canvas?: HTMLCanvasElement;
    width?: number;
    height?: number;
    autoLoop?: boolean;
    makeGlobal?: boolean;
    detectAudio?: boolean;
    enableStreamCapture?: boolean;
    numSources?: number;
    numOutputs?: number;
    precision?: "highp" | "mediump" | "lowp";
  }

  export default class Hydra {
    constructor(options?: HydraOptions);
    // biome-ignore lint/suspicious/noExplicitAny: hydra-synth ships no types
    [key: string]: any;
  }
}

declare module "hydra-synth/src/glsl/glsl-functions.js" {
  const glslFunctions: () => unknown[];
  export default glslFunctions;
}
