import type { Engine, SourceStatus } from "../hydra/engine";

/** The key nodes find the editor under */
export const EDITOR = Symbol("editor");

/** What a node needs from the editor around it */
export interface EditorContext {
  /** Undefined until the canvas is up */
  readonly engine: Engine | undefined;
  /** Where an input node stands: opening, playing, missing its file… */
  status: (nodeId: string) => SourceStatus | undefined;
  /** An input node past hydra's four inputs: it has nothing to play on */
  crowded: (nodeId: string) => boolean;
  /** Give a picture or video node its file */
  attach: (nodeId: string, file: File) => void;
  /** What a control node is called, in code and on what it is wired into: `lfo`, `lfo2` */
  controlName: (nodeId: string) => string | undefined;
}
