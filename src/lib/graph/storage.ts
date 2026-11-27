/**
 * A patch as it is saved: the graph plus where each node sits and how it is
 * shown. Anything read back is checked piece by piece, since a saved patch
 * can come from an older version or from someone else.
 */
import { getDef, type NodeDef } from "../hydra/catalog";
import { AUDIO_DEFAULTS, type AudioSettings, MAX_AUDIO_BINS, sameAudio, tidyAudio } from "./audio";
import { connect, wouldCycle } from "./edit";
import { WAVES } from "./params";
import {
  type Drive,
  type InputName,
  inputParam,
  type MediaRef,
  type ParamState,
  type PatchEdge,
  type PatchNode,
  type Shown,
} from "./types";

export interface SavedNode extends PatchNode {
  x: number;
  y: number;
  /** Shown as one line of code */
  collapsed?: boolean;
  /** It shows a live preview of its texture */
  preview?: boolean;
  /** Every parameter shows at rest, not only the main ones */
  more?: boolean;
}

export interface SavedPatch {
  v: 1;
  nodes: SavedNode[];
  edges: PatchEdge[];
  /** The output that plays behind the editor, or all four */
  shown: Shown;
  /** How the sound is read, when that isn't hydra's own way */
  audio?: AudioSettings;
}

const MAX_NODES = 500;
const MAX_STEPS = 32;
const MAX_NAME = 200;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function parseDrive(raw: unknown): Drive | undefined {
  if (!isRecord(raw)) return undefined;
  const { min, max } = raw;
  switch (raw.mode) {
    case "seq": {
      if (!Array.isArray(raw.values) || !isNumber(raw.fast)) return undefined;
      const values = raw.values.filter(isNumber).slice(0, MAX_STEPS);
      if (values.length === 0) return undefined;
      return { mode: "seq", values, fast: raw.fast, smooth: raw.smooth === true };
    }
    case "lfo": {
      const wave = WAVES.find((known) => known === raw.wave);
      if (!wave || !isNumber(raw.rate) || !isNumber(min) || !isNumber(max)) return undefined;
      return { mode: "lfo", wave, rate: raw.rate, min, max };
    }
    case "audio": {
      const { bin } = raw;
      if (!isNumber(bin) || !Number.isInteger(bin) || bin < 0 || bin >= MAX_AUDIO_BINS) {
        return undefined;
      }
      if (!isNumber(min) || !isNumber(max)) return undefined;
      return { mode: "audio", bin, min, max };
    }
    case "mouse": {
      if ((raw.axis !== "x" && raw.axis !== "y") || !isNumber(min) || !isNumber(max)) {
        return undefined;
      }
      return { mode: "mouse", axis: raw.axis, min, max };
    }
    default:
      return undefined;
  }
}

function parseParams(raw: unknown, def: NodeDef): Record<string, ParamState> {
  const params: Record<string, ParamState> = {};
  const given = isRecord(raw) ? raw : {};
  for (const param of def.params) {
    const state = given[param.name];
    const value = isRecord(state) && isNumber(state.value) ? state.value : param.default;
    // A control's own settings are plain numbers: nothing drives the driver
    const drive = isRecord(state) && !def.control ? parseDrive(state.drive) : undefined;
    params[param.name] = drive ? { value, drive } : { value };
  }
  return params;
}

/** The name of a file and where this browser keeps it: never the file itself */
function parseMedia(raw: unknown): MediaRef | undefined {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.name !== "string") {
    return undefined;
  }
  if (raw.id === "" || raw.id.length > 64) return undefined;
  return { id: raw.id, name: raw.name.slice(0, MAX_NAME) };
}

function parseNode(raw: unknown): SavedNode | undefined {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.fn !== "string") return undefined;
  const def = getDef(raw.fn);
  if (!def) return undefined;
  const node: SavedNode = {
    id: raw.id,
    fn: def.type,
    params: parseParams(raw.params, def),
    x: isNumber(raw.x) ? raw.x : 0,
    y: isNumber(raw.y) ? raw.y : 0,
  };
  if (def.options) {
    const option = isNumber(raw.option) ? Math.trunc(raw.option) : 0;
    node.option = option >= 0 && option < def.options.length ? option : 0;
  }
  if (def.source === "image" || def.source === "video") {
    const media = parseMedia(raw.media);
    if (media) node.media = media;
  }
  if (raw.collapsed === true) node.collapsed = true;
  if (raw.preview === true) node.preview = true;
  if (raw.more === true) node.more = true;
  return node;
}

/** Only what differs from hydra's own is kept: most patches say nothing about the sound */
function parseAudio(raw: unknown): AudioSettings | undefined {
  if (!isRecord(raw)) return undefined;
  const audio = tidyAudio(raw);
  return sameAudio(audio, AUDIO_DEFAULTS) ? undefined : audio;
}

/**
 * A node that listens to a band the sound isn't cut into listens to the last
 * one there is: the one rule for it, used by the parser and by the editor
 * when the bands get fewer. Gives the node back as it was when it fits.
 */
export function withinBands<T extends Pick<PatchNode, "fn" | "params" | "option">>(
  node: T,
  bins: number,
): T {
  const last = bins - 1;
  let fitted = node;
  if (getDef(node.fn)?.control === "audio" && (node.option ?? 0) > last) {
    fitted = { ...fitted, option: last };
  }
  for (const [name, state] of Object.entries(node.params)) {
    if (state.drive?.mode !== "audio" || state.drive.bin <= last) continue;
    const params = { ...fitted.params, [name]: { ...state, drive: { ...state.drive, bin: last } } };
    fitted = { ...fitted, params };
  }
  return fitted;
}

function parseEdges(raw: unknown, nodes: SavedNode[]): PatchEdge[] {
  if (!Array.isArray(raw)) return [];
  const defs = new Map(nodes.map((node) => [node.id, getDef(node.fn)]));
  let edges: PatchEdge[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const { source, target, input } = item;
    if (typeof source !== "string" || typeof target !== "string" || typeof input !== "string") {
      continue;
    }
    const from = defs.get(source);
    const to = defs.get(target);
    if (!from || !to || !fits(from, to, input)) continue;
    if (wouldCycle(edges, source, target)) continue;
    edges = connect(edges, { source, target, input });
  }
  return edges;
}

/**
 * Can a wire from one node go into this input of another? A control's number
 * goes into parameters, of nodes that aren't controls themselves; a texture
 * goes into `in`, a node's first texture input, or `by`, its second.
 */
export function fits(from: NodeDef, to: NodeDef, input: string): input is InputName {
  if (!from.hasOutput) return false;
  const param = inputParam(input);
  if (param !== undefined) {
    return Boolean(from.control) && !to.control && to.params.some((known) => known.name === param);
  }
  if (from.control || (input !== "in" && input !== "by")) return false;
  return to.inputs >= (input === "in" ? 1 : 2);
}

/** A saved patch from parsed JSON, or nothing if it isn't one */
export function parsePatch(raw: unknown): SavedPatch | undefined {
  if (!isRecord(raw) || raw.v !== 1 || !Array.isArray(raw.nodes)) return undefined;
  const audio = parseAudio(raw.audio);
  const { bins } = audio ?? AUDIO_DEFAULTS;
  const nodes: SavedNode[] = [];
  const ids = new Set<string>();
  for (const item of raw.nodes.slice(0, MAX_NODES)) {
    const node = parseNode(item);
    if (!node || ids.has(node.id)) continue;
    ids.add(node.id);
    nodes.push(withinBands(node, bins));
  }
  const one = isNumber(raw.shown) && [0, 1, 2, 3].includes(raw.shown) ? raw.shown : 0;
  const shown = raw.shown === "all" ? "all" : one;
  const patch: SavedPatch = { v: 1, nodes, edges: parseEdges(raw.edges, nodes), shown };
  if (audio) patch.audio = audio;
  return patch;
}

const value = (number: number): ParamState => ({ value: number });

/** What a new visitor finds: a small patch that already moves */
export function starterPatch(): SavedPatch {
  return {
    v: 1,
    shown: 0,
    nodes: [
      {
        id: "osc",
        fn: "osc",
        x: 0,
        y: 40,
        params: { frequency: value(40), sync: value(0.06), offset: value(0) },
      },
      // One preview is on from the start, to show that every node has one
      { id: "kaleid", fn: "kaleid", x: 290, y: 40, params: { nSides: value(6) }, preview: true },
      {
        id: "noise",
        fn: "noise",
        x: 290,
        y: 290,
        params: { scale: value(3), offset: value(0.1) },
      },
      { id: "modulate", fn: "modulate", x: 580, y: 40, params: { amount: value(0.25) } },
      {
        id: "color",
        fn: "color",
        x: 870,
        y: 40,
        params: { r: value(0.56), g: value(0.1), b: value(1), a: value(1) },
      },
      { id: "out", fn: "out", x: 1160, y: 40, params: {}, option: 0 },
    ],
    edges: [
      { source: "osc", target: "kaleid", input: "in" },
      { source: "kaleid", target: "modulate", input: "in" },
      { source: "noise", target: "modulate", input: "by" },
      { source: "modulate", target: "color", input: "in" },
      { source: "color", target: "out", input: "in" },
    ],
  };
}
