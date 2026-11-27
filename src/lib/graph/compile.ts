/**
 * From a patch to hydra: an expression per node (the texture it produces),
 * which prints as hydra code and builds into hydra's own chain objects.
 */
import { getDef, MAX_SOURCES, type NodeDef, type SourceKind } from "../hydra/catalog";
import { paramCode } from "./params";
import type { InputName, MediaRef, ParamState, Patch, PatchNode } from "./types";

export type Expr =
  /** `input.fn(by, ...params)`, or `fn(...params)` for a source */
  | { kind: "call"; node: PatchNode; def: NodeDef; input?: Expr; by?: Expr }
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

export interface Compiled {
  /** One per `out` node, in patch order: a later one on the same buffer wins */
  outputs: { nodeId: string; buffer: number; expr: Expr }[];
  /** At most four: hydra has no more inputs, and a fifth input node draws nothing */
  sources: Source[];
  /** The texture a node produces; an `out` node shows what goes into it */
  exprOf: (nodeId: string) => Expr;
}

const EMPTY: Expr = { kind: "empty" };

export function paramOf(node: PatchNode, name: string, fallback: number): ParamState {
  return node.params[name] ?? { value: fallback };
}

export function compile(patch: Patch): Compiled {
  const nodes = new Map(patch.nodes.map((node) => [node.id, node]));
  const inputs = new Map<string, string>();
  for (const edge of patch.edges) inputs.set(`${edge.target}.${edge.input}`, edge.source);

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
    if (!def) return EMPTY;
    if (node.fn === "out") return inputOf(node.id, "in");
    if (node.fn === "src") return { kind: "buffer", name: `o${node.option ?? 0}` };
    if (def.source) {
      const slot = slots.get(node.id);
      return slot === undefined ? EMPTY : { kind: "buffer", name: `s${slot}` };
    }
    const expr: Expr = { kind: "call", node, def };
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

  return { outputs, sources, exprOf };
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

/** The parameters as written in code: trailing defaults left off, as people write hydra */
export function argsCode(node: PatchNode, def: NodeDef): string[] {
  const args = def.params.map((param) => paramCode(paramOf(node, param.name, param.default)));
  let length = args.length;
  while (length > 0) {
    const param = def.params[length - 1];
    const state = paramOf(node, param.name, param.default);
    if (state.drive || state.value !== param.default) break;
    length--;
  }
  return args.slice(0, length);
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
  const args = argsCode(expr.node, expr.def);
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
export function nodeCode(node: PatchNode, def: NodeDef): string {
  if (def.options) return `${def.type}(${def.options[node.option ?? 0] ?? ""})`;
  if (def.source) return `${def.type}(${node.media?.name ?? ""})`;
  const by = def.inputs === 2 ? ["…"] : [];
  return `${def.type}(${[...by, ...argsCode(node, def)].join(", ")})`;
}

/* ── As hydra chains ────────────────────────────────────── */

/** A hydra chain object: every transform is a method that returns the chain */
// biome-ignore lint/suspicious/noExplicitAny: hydra's chains have no types
export type Chain = any;

export interface BuildContext {
  /** hydra's synth object: the generators and the buffers */
  synth: Chain;
  /** A parameter as hydra takes it: a function it calls every frame */
  arg: (node: PatchNode, name: string, fallback: number) => unknown;
}

export function buildChain(expr: Expr, ctx: BuildContext): Chain {
  if (expr.kind === "empty") return ctx.synth.solid(0, 0, 0, 0);
  if (expr.kind === "buffer") return ctx.synth.src(ctx.synth[expr.name]);
  const { node, def } = expr;
  const args = def.params.map((param) => ctx.arg(node, param.name, param.default));
  if (def.inputs === 0) return ctx.synth[def.type](...args);
  const base = buildChain(expr.input ?? EMPTY, ctx);
  if (def.inputs === 1) return base[def.type](...args);
  return base[def.type](buildChain(expr.by ?? EMPTY, ctx), ...args);
}
