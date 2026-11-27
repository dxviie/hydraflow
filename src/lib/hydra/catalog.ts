/**
 * The node catalog. Every hydra function becomes a node type, read from
 * hydra's own definitions (name, kind, parameters, defaults), with what the
 * editor adds on top: a range to scrub in, which parameters show at rest,
 * and a one line description.
 */
import glslFunctions from "hydra-synth/src/glsl/glsl-functions.js";

export type Category = "source" | "geometry" | "color" | "blend" | "modulate" | "input" | "output";

export interface ParamDef {
  name: string;
  default: number;
  /** The range the row scrubs in; typing a value can go past it */
  min: number;
  max: number;
  step: number;
}

export interface NodeDef {
  type: string;
  category: Category;
  /** Texture inputs: 0 for a source, 1 for a transform, 2 when it mixes another texture in */
  inputs: 0 | 1 | 2;
  hasOutput: boolean;
  params: ParamDef[];
  /** How many parameters show at rest, before "+ n more" */
  primary: number;
  /** Buffers or devices to pick from (`out`, `src`, `cam`) */
  options?: string[];
  doc: string;
}

export const CATEGORIES: Record<Category, { label: string; tag: string; color: string }> = {
  source: { label: "sources", tag: "src", color: "#ffaa99" },
  geometry: { label: "geometry", tag: "geo", color: "#ffee99" },
  color: { label: "color", tag: "col", color: "#ccff99" },
  blend: { label: "blend", tag: "mix", color: "#99ffaa" },
  modulate: { label: "modulate", tag: "mod", color: "#99ffee" },
  input: { label: "inputs", tag: "in", color: "#99ccff" },
  output: { label: "output", tag: "out", color: "#aa99ff" },
};

const KINDS: Record<string, { category: Category; inputs: 0 | 1 | 2 }> = {
  src: { category: "source", inputs: 0 },
  coord: { category: "geometry", inputs: 1 },
  color: { category: "color", inputs: 1 },
  combine: { category: "blend", inputs: 2 },
  combineCoord: { category: "modulate", inputs: 2 },
};

/** Handled as nodes of their own (`src`), or not useful in a patch */
const SKIPPED = new Set(["src", "prev", "sum"]);

type Range = [min: number, max: number, step?: number];

const UNIT: Range = [0, 1, 0.01];
const SIGNED: Range = [-1, 1, 0.01];
const SPEED: Range = [-2, 2, 0.01];
const COUNT: Range = [1, 20, 0.1];
const ANGLE: Range = [-6.28, 6.28, 0.01];

/** Ranges by parameter name, for when a function doesn't set its own */
const RANGES_BY_NAME: Record<string, Range> = {
  amount: UNIT,
  r: UNIT,
  g: UNIT,
  b: UNIT,
  a: UNIT,
  threshold: UNIT,
  tolerance: UNIT,
  blending: UNIT,
  smoothing: UNIT,
  radius: UNIT,
  offset: UNIT,
  offsetX: UNIT,
  offsetY: UNIT,
  scrollX: SIGNED,
  scrollY: SIGNED,
  speed: SPEED,
  speedX: SPEED,
  speedY: SPEED,
  sync: SIGNED,
  reps: COUNT,
  repeatX: COUNT,
  repeatY: COUNT,
  nSides: [1, 24, 0.1],
  sides: [3, 12, 1],
  scale: [0, 50, 0.1],
  frequency: [0, 200, 0.1],
  pixelX: [1, 200, 1],
  pixelY: [1, 200, 1],
  angle: ANGLE,
  multiple: [0, 5, 0.01],
  xMult: [0.1, 5, 0.01],
  yMult: [0.1, 5, 0.01],
  bins: [1, 16, 1],
  gamma: [0, 2, 0.01],
  hue: UNIT,
};

/** Ranges that belong to one function's parameter: `fn.param` */
const RANGES: Record<string, Range> = {
  "noise.offset": [0, 2, 0.01],
  "osc.offset": [0, 3.14, 0.01],
  "scale.amount": [0.1, 5, 0.01],
  "contrast.amount": [0, 5, 0.01],
  "brightness.amount": SIGNED,
  "saturate.amount": [0, 10, 0.01],
  "modulateHue.amount": [0, 5, 0.01],
  "r.scale": [0, 2, 0.01],
  "g.scale": [0, 2, 0.01],
  "b.scale": [0, 2, 0.01],
  "a.scale": [0, 2, 0.01],
  "r.offset": SIGNED,
  "g.offset": SIGNED,
  "b.offset": SIGNED,
  "a.offset": SIGNED,
  "modulateScale.offset": [0, 5, 0.01],
  "modulatePixelate.multiple": [0, 200, 1],
  "modulatePixelate.offset": [0, 50, 0.1],
  "modulateRotate.multiple": ANGLE,
  "modulateRotate.offset": ANGLE,
};

const PRIMARY: Record<string, number> = {
  color: 3,
  solid: 3,
  shift: 3,
  scale: 1,
  shape: 2,
};

const DOCS: Record<string, string> = {
  noise: "soft, drifting noise",
  voronoi: "cells that move",
  osc: "sine wave stripes",
  shape: "a polygon",
  gradient: "a colour gradient",
  solid: "one flat colour",
  rotate: "turn the picture",
  scale: "zoom in or out",
  pixelate: "big square pixels",
  repeat: "tile it in a grid",
  repeatX: "tile it sideways",
  repeatY: "tile it up and down",
  kaleid: "mirror it around the centre",
  scroll: "slide it both ways",
  scrollX: "slide it sideways",
  scrollY: "slide it up and down",
  posterize: "fewer colour steps",
  shift: "shift the colour channels",
  invert: "flip the colours",
  contrast: "push lights and darks apart",
  brightness: "lighter or darker",
  luma: "cut out the dark parts",
  thresh: "black or white, nothing between",
  color: "tint each channel",
  saturate: "more or less colour",
  hue: "rotate the hue",
  colorama: "cycle through colours",
  r: "keep the red channel",
  g: "keep the green channel",
  b: "keep the blue channel",
  a: "keep the alpha channel",
  add: "add another texture",
  sub: "subtract another texture",
  layer: "put another texture on top",
  blend: "fade towards another texture",
  mult: "multiply by another texture",
  diff: "the difference with another texture",
  mask: "cut out with another texture",
  modulate: "warp with another texture",
  modulateRepeat: "tile, warped by another texture",
  modulateRepeatX: "tile sideways, warped by another texture",
  modulateRepeatY: "tile up and down, warped by another texture",
  modulateKaleid: "mirror, warped by another texture",
  modulateScrollX: "slide sideways by another texture",
  modulateScrollY: "slide up and down by another texture",
  modulateScale: "zoom by another texture",
  modulatePixelate: "pixelate by another texture",
  modulateRotate: "turn by another texture",
  modulateHue: "shift hue by another texture",
};

interface HydraInput {
  name: string;
  type: string;
  default: number;
}

interface HydraFunction {
  name: string;
  type: string;
  inputs: HydraInput[];
}

function rangeFor(fn: string, input: HydraInput): Range {
  const known = RANGES[`${fn}.${input.name}`] ?? RANGES_BY_NAME[input.name];
  if (known) return known;
  // A parameter hydra adds later: guess from its default
  const reach = Math.max(1, Math.abs(input.default) * 4);
  return [input.default < 0 ? -reach : 0, reach, 0.01];
}

function fromHydra(fn: HydraFunction): NodeDef {
  const kind = KINDS[fn.type];
  const params = fn.inputs
    .filter((input) => input.type === "float")
    .map((input) => {
      const [min, max, step = 0.01] = rangeFor(fn.name, input);
      return { name: input.name, default: input.default, min, max, step };
    });
  return {
    type: fn.name,
    category: kind.category,
    inputs: kind.inputs,
    hasOutput: true,
    params,
    primary: Math.min(params.length, PRIMARY[fn.name] ?? 2),
    doc: DOCS[fn.name] ?? "",
  };
}

const BUFFERS = ["o0", "o1", "o2", "o3"];

/** Nodes that aren't one hydra function */
const SPECIAL: NodeDef[] = [
  {
    type: "src",
    category: "source",
    inputs: 0,
    hasOutput: true,
    params: [],
    primary: 0,
    options: BUFFERS,
    doc: "read an output back in: feedback",
  },
  {
    type: "cam",
    category: "input",
    inputs: 0,
    hasOutput: true,
    params: [],
    primary: 0,
    options: ["cam 0", "cam 1", "cam 2", "cam 3"],
    doc: "your camera",
  },
  {
    type: "out",
    category: "output",
    inputs: 1,
    hasOutput: false,
    params: [],
    primary: 0,
    options: BUFFERS,
    doc: "send it to an output",
  },
];

const hydraDefs = (glslFunctions() as HydraFunction[])
  .filter((fn) => fn.type in KINDS && !SKIPPED.has(fn.name))
  .map(fromHydra);

export const NODE_DEFS: NodeDef[] = [...hydraDefs, ...SPECIAL];

const byType = new Map(NODE_DEFS.map((def) => [def.type, def]));

export function getDef(type: string): NodeDef | undefined {
  return byType.get(type);
}

/** How many camera, image and video inputs hydra has: s0 to s3 */
export const MAX_SOURCES = 4;
