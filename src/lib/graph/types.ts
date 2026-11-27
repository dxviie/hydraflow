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

/** A file of the person's own, kept in their browser: the patch only names it */
export interface MediaRef {
  id: string;
  name: string;
}

export interface PatchNode {
  id: string;
  /** A catalog type: a hydra function, or `out`, `src`, or an input such as `cam` */
  fn: string;
  params: Record<string, ParamState>;
  /** Which buffer (`out`, `src`) or which camera (`cam`) */
  option?: number;
  /** The file an `image` or `video` node plays */
  media?: MediaRef;
}

/** A node that makes a number instead of a picture, to wire into parameters */
export type ControlKind = "lfo" | "audio";

/**
 * Where a wire goes into a node: the chain it continues (`in`), the texture
 * it mixes in (`by`), or one of its parameters (`p:frequency`), which takes a
 * number from a control node.
 */
export type InputName = "in" | "by" | `p:${string}`;

export const paramInput = (name: string): InputName => `p:${name}`;

/** The parameter an input stands for, or nothing for a texture input */
export function inputParam(input: string): string | undefined {
  return input.startsWith("p:") ? input.slice(2) : undefined;
}

export interface PatchEdge {
  source: string;
  target: string;
  input: InputName;
}

export interface Patch {
  nodes: PatchNode[];
  edges: PatchEdge[];
}
