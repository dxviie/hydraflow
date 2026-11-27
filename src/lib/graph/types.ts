/**
 * A patch: hydra functions as nodes, textures flowing along the edges.
 * Nothing here knows about Svelte Flow or the browser.
 */

export type Wave = "sine" | "saw" | "square" | "tri";

/** What moves a parameter when it isn't a plain number */
export type Drive =
  /** hydra's arrays: `[20, 40, 80].fast(0.5).smooth()` */
  | { mode: "seq"; values: number[]; fast: number; smooth: boolean }
  | { mode: "lfo"; wave: Wave; rate: number; min: number; max: number }
  /** `a.fft[bin]`, stretched between min and max */
  | { mode: "audio"; bin: number; min: number; max: number }
  | { mode: "mouse"; axis: "x" | "y"; min: number; max: number };

export type DriveMode = Drive["mode"];

export interface ParamState {
  /** The plain number, kept while a drive is on so turning it off restores it */
  value: number;
  drive?: Drive;
}

export interface PatchNode {
  id: string;
  /** A catalog type: a hydra function, or `out`, `src`, `cam` */
  fn: string;
  params: Record<string, ParamState>;
  /** Which buffer (`out`, `src`) or which camera (`cam`) */
  option?: number;
}

/** The texture inputs of a node: the chain it continues, and what it mixes in */
export type InputName = "in" | "by";

export interface PatchEdge {
  source: string;
  target: string;
  input: InputName;
}

export interface Patch {
  nodes: PatchNode[];
  edges: PatchEdge[];
}
