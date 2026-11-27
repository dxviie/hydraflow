/**
 * From a patch to hydra: an expression per node (the texture it produces),
 * which prints as hydra code and builds into hydra's own chain objects.
 */
import { getDef, MAX_SOURCES, type NodeDef, type SourceKind } from "../hydra/catalog";
import { controlDrive, driveCode, paramCode } from "./params";
import {
  type Drive,
  type InputName,
  inputParam,
  type MediaRef,
  type ParamState,
  type Patch,
  type PatchNode,
} from "./types";

/** The control each wired parameter of a node takes its number from, by parameter name */
export type Wires = Record<string, Control>;

/** The same, when only what the control is called matters */
export type WireNames = Record<string, { name: string }>;

export type Expr =
  /** `input.fn(by, ...params)`, or `fn(...params)` for a source */
  | { kind: "call"; node: PatchNode; def: NodeDef; input?: Expr; by?: Expr; wires?: Wires }
  /** `src(o0)` or `src(s0)` */
  | { kind: "buffer"; name: string }
  /** Nothing plugged in: transparent black */
  | { kind: "empty" };

/** Something from outside the patch, and the hydra input it plays on */
export interface Source {
  nodeId: string;
  kind: SourceKind;
  /** Which of hydra's s0 to s3 */
  slot: number;
  /** Which camera */
  device: number;
  /** Which file, for a picture or a video that has one */
  media?: MediaRef;
}

/** A node whose output is a number: in code, a function with a name of its own */
export interface Control {
  nodeId: string;
  /** What it is called in code and on its node: `lfo`, `lfo2`, `audio` */
  name: string;
  /** What its settings add up to */
  drive: Drive;
  /** Wired into at least one parameter */
  used: boolean;
}

export interface Compiled {
  /** One per `out` node, in patch order: a later one on the same buffer wins */
  outputs: { nodeId: string; buffer: number; expr: Expr }[];
  /** At most four: hydra has no more inputs, and a fifth input node draws nothing */
  sources: Source[];
  controls: Control[];
  /** The control node wired into a parameter, if one is */
  controlOf: (nodeId: string, param: string) => Control | undefined;
  /** The texture a node produces; an `out` node shows what goes into it */
  exprOf: (nodeId: string) => Expr;
}

const EMPTY: Expr = { kind: "empty" };

export function paramOf(node: PatchNode, name: string, fallback: number): ParamState {
  return node.params[name] ?? { value: fallback };
}

/** The control nodes of a patch, named in patch order: `lfo`, `lfo2`, `audio`… */
export function controlsOf(nodes: PatchNode[]): Control[] {
  const counts: Record<string, number> = {};
  const controls: Control[] = [];
  for (const node of nodes) {
    const kind = getDef(node.fn)?.control;
    if (!kind) continue;
    const count = (counts[kind] ?? 0) + 1;
    counts[kind] = count;
    controls.push({
      nodeId: node.id,
      name: count === 1 ? kind : `${kind}${count}`,
      drive: controlDrive(kind, node),
      used: false,
    });
  }
  return controls;
}

export function compile(patch: Patch): Compiled {
  const nodes = new Map(patch.nodes.map((node) => [node.id, node]));
  const controls = controlsOf(patch.nodes);
  const controlById = new Map(controls.map((control) => [control.nodeId, control]));

  // Texture wires by the input they go into; value wires by the parameter they drive
  const inputs = new Map<string, string>();
  const wires = new Map<string, Wires>();
  for (const edge of patch.edges) {
    const param = inputParam(edge.input);
    if (param === undefined) {
      inputs.set(`${edge.target}.${edge.input}`, edge.source);
      continue;
    }
    const control = controlById.get(edge.source);
    const target = nodes.get(edge.target);
    const def = target && getDef(target.fn);
    if (!control || !def || def.control || !def.params.some((known) => known.name === param)) {
      continue;
    }
    control.used = true;
    wires.set(edge.target, { ...wires.get(edge.target), [param]: control });
  }

  const sources: Source[] = [];
  for (const node of patch.nodes) {
    const kind = getDef(node.fn)?.source;
    if (!kind || sources.length === MAX_SOURCES) continue;
    const source: Source = {
      nodeId: node.id,
      kind,
      slot: sources.length,
      device: node.option ?? 0,
    };
    if (node.media) source.media = node.media;
    sources.push(source);
  }
  const slots = new Map(sources.map((source) => [source.nodeId, source.slot]));

  const cache = new Map<string, Expr>();
  const visiting = new Set<string>();

  const inputOf = (nodeId: string, input: InputName): Expr => {
    const source = inputs.get(`${nodeId}.${input}`);
    return source === undefined ? EMPTY : exprOf(source);
  };

  const build = (node: PatchNode): Expr => {
    const def = getDef(node.fn);
    // A control makes a number, not a picture
    if (!def || def.control) return EMPTY;
    if (node.fn === "out") return inputOf(node.id, "in");
    if (node.fn === "src") return { kind: "buffer", name: `o${node.option ?? 0}` };
    if (def.source) {
      const slot = slots.get(node.id);
      return slot === undefined ? EMPTY : { kind: "buffer", name: `s${slot}` };
    }
    const expr: Expr = { kind: "call", node, def };
    const wired = wires.get(node.id);
    if (wired) expr.wires = wired;
    if (def.inputs >= 1) expr.input = inputOf(node.id, "in");
    if (def.inputs === 2) expr.by = inputOf(node.id, "by");
    return expr;
  };

  function exprOf(nodeId: string): Expr {
    const cached = cache.get(nodeId);
    if (cached) return cached;
    const node = nodes.get(nodeId);
    // A loop can't be drawn in one pass: feedback goes through a `src` node
    if (!node || visiting.has(nodeId)) return EMPTY;
    visiting.add(nodeId);
    const expr = build(node);
    visiting.delete(nodeId);
    cache.set(nodeId, expr);
    return expr;
  }

  const outputs = patch.nodes
    .filter((node) => node.fn === "out")
    .map((node) => ({ nodeId: node.id, buffer: node.option ?? 0, expr: exprOf(node.id) }));

  const controlOf = (nodeId: string, param: string) => wires.get(nodeId)?.[param];

  return { outputs, sources, controls, controlOf, exprOf };
}

/**
 * Everything that needs new shaders when it changes. Parameter values are
 * left out: hydra reads those every frame.
 */
export function signature(patch: Patch): string {
  const nodes = patch.nodes.map(
    (node) => `${node.id}:${node.fn}:${node.option ?? 0}:${node.media?.id ?? ""}`,
  );
  const edges = patch.edges.map((edge) => `${edge.source}>${edge.target}.${edge.input}`).sort();
  return `${nodes.join(",")}|${edges.join(",")}`;
}

/* ── As hydra code ──────────────────────────────────────── */

/**
 * The parameters as written in code: a wired one by the name of its control,
 * and trailing defaults left off, as people write hydra.
 */
export function argsCode(node: PatchNode, def: NodeDef, wires: WireNames = {}): string[] {
  const args = def.params.map(
    (param) => wires[param.name]?.name ?? paramCode(paramOf(node, param.name, param.default)),
  );
  let length = args.length;
  while (length > 0) {
    const param = def.params[length - 1];
    const state = paramOf(node, param.name, param.default);
    if (wires[param.name] || state.drive || state.value !== param.default) break;
    length--;
  }
  return args.slice(0, length);
}

/** A control node as the line of code it stands for: `var lfo = () => …` */
export function controlCode(control: Pick<Control, "name" | "drive">): string {
  // `var`, not `const`: hydra's editor runs a sketch again in the same scope
  return `var ${control.name} = ${driveCode(control.drive)}`;
}

/** The calls of a chain, first to last */
function spine(expr: Expr): Expr[] {
  const calls: Expr[] = [];
  let current: Expr | undefined = expr;
  while (current) {
    calls.unshift(current);
    current = current.kind === "call" ? current.input : undefined;
  }
  return calls;
}

const pad = (depth: number) => "  ".repeat(depth);

function isShort(expr: Expr): boolean {
  const calls = spine(expr);
  return calls.length <= 2 && calls.every((call) => call.kind !== "call" || !call.by);
}

function callCode(expr: Expr, depth: number): string {
  if (expr.kind === "empty") return "solid(0, 0, 0, 0)";
  if (expr.kind === "buffer") return `src(${expr.name})`;
  const args = argsCode(expr.node, expr.def, expr.wires);
  if (!expr.by) return `${expr.def.type}(${args.join(", ")})`;
  if (isShort(expr.by)) {
    return `${expr.def.type}(${[chainCode(expr.by, depth, true), ...args].join(", ")})`;
  }
  const inner = [chainCode(expr.by, depth + 1, false), ...args.map((arg) => pad(depth + 1) + arg)];
  return `${expr.def.type}(\n${inner.join(",\n")}\n${pad(depth)})`;
}

/** A chain, one call per line unless `inline` */
function chainCode(expr: Expr, depth: number, inline: boolean, tail = ""): string {
  const [head, ...rest] = spine(expr);
  const lines = [pad(inline ? 0 : depth) + callCode(head, depth)];
  for (const call of rest) {
    const code = `.${callCode(call, depth + 1)}`;
    lines.push(inline ? code : pad(depth + 1) + code);
  }
  if (tail) lines.push(inline ? tail : pad(depth + 1) + tail);
  return lines.join(inline ? "" : "\n");
}

/** The patch as a hydra sketch, ready to paste into any hydra editor */
export function toCode(compiled: Compiled, shown = 0): string {
  const parts: string[] = [];
  const inits = compiled.sources.map(sourceCode).filter((line) => line !== "");
  if (inits.length > 0) parts.push(inits.join("\n"));
  const used = compiled.controls.filter((control) => control.used);
  if (used.length > 0) parts.push(used.map(controlCode).join("\n"));
  for (const output of compiled.outputs) {
    parts.push(chainCode(output.expr, 0, false, `.out(o${output.buffer})`));
  }
  if (shown !== 0) parts.push(`render(o${shown})`);
  return parts.join("\n\n");
}

/**
 * The line that starts an input. A file of the person's own has no address
 * anyone else can load, so it is written the way HYDRACTRL's desktop app
 * serves its media folder: there, the same file under the same name plays.
 */
function sourceCode(source: Source): string {
  const input = `s${source.slot}`;
  switch (source.kind) {
    case "cam":
      return `${input}.initCam(${source.device})`;
    case "screen":
      return `${input}.initScreen()`;
    case "image":
    case "video": {
      if (!source.media) return "";
      const init = source.kind === "image" ? "initImage" : "initVideo";
      return `${input}.${init}(${JSON.stringify(`/media/${source.media.name}`)})`;
    }
  }
}

/** A node on one line, the way it reads when collapsed: `osc(40, 0.06)` */
export function nodeCode(node: PatchNode, def: NodeDef, wires: WireNames = {}): string {
  if (def.control) return driveCode(controlDrive(def.control, node));
  if (def.options) return `${def.type}(${def.options[node.option ?? 0] ?? ""})`;
  if (def.source) return `${def.type}(${node.media?.name ?? ""})`;
  const by = def.inputs === 2 ? ["…"] : [];
  return `${def.type}(${[...by, ...argsCode(node, def, wires)].join(", ")})`;
}

/* ── As hydra chains ────────────────────────────────────── */

/** A hydra chain object: every transform is a method that returns the chain */
// biome-ignore lint/suspicious/noExplicitAny: hydra's chains have no types
export type Chain = any;

export interface BuildContext {
  /** hydra's synth object: the generators and the buffers */
  synth: Chain;
  /**
   * A parameter as hydra takes it: a function it calls every frame. With a
   * control wired into it, that control's number; otherwise its own.
   */
  arg: (node: PatchNode, name: string, fallback: number, control?: Control) => unknown;
}

export function buildChain(expr: Expr, ctx: BuildContext): Chain {
  if (expr.kind === "empty") return ctx.synth.solid(0, 0, 0, 0);
  if (expr.kind === "buffer") return ctx.synth.src(ctx.synth[expr.name]);
  const { node, def } = expr;
  const args = def.params.map((param) =>
    ctx.arg(node, param.name, param.default, expr.wires?.[param.name]),
  );
  if (def.inputs === 0) return ctx.synth[def.type](...args);
  const base = buildChain(expr.input ?? EMPTY, ctx);
  if (def.inputs === 1) return base[def.type](...args);
  return base[def.type](buildChain(expr.by ?? EMPTY, ctx), ...args);
}
