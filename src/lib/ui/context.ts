import type { Engine } from "../hydra/engine";

/** The key nodes find the engine under, to draw their previews */
export const ENGINE = Symbol("engine");

export interface EngineContext {
  /** Undefined until the canvas is up */
  readonly current: Engine | undefined;
}
