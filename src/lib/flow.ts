/**
 * Between the patch and Svelte Flow: its nodes and edges are the patch while
 * the editor is open.
 */
import type { Edge, Node } from "@xyflow/svelte";

import { AUDIO_DEFAULTS, type AudioSettings, sameAudio } from "./graph/audio";
import type { SavedNode, SavedPatch } from "./graph/storage";
import {
  type InputName,
  inputParam,
  type MediaRef,
  type ParamState,
  type Patch,
  type PatchEdge,
  type Shown,
} from "./graph/types";
import { getDef, type NodeDef } from "./hydra/catalog";

export interface HydraNodeData extends Record<string, unknown> {
  fn: string;
  params: Record<string, ParamState>;
  option?: number;
  media?: MediaRef;
  collapsed?: boolean;
  preview?: boolean;
  more?: boolean;
}

export type FlowNode = Node<HydraNodeData, "hydra">;
export type FlowEdge = Edge;

export function defaultParams(def: NodeDef): Record<string, ParamState> {
  return Object.fromEntries(def.params.map((param) => [param.name, { value: param.default }]));
}

export function newId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function newNode(def: NodeDef, position: { x: number; y: number }): FlowNode {
  const data: HydraNodeData = { fn: def.type, params: defaultParams(def) };
  if (def.options) data.option = 0;
  return { id: newId(), type: "hydra", position, data };
}

export function toFlowEdge(edge: PatchEdge): FlowEdge {
  return {
    id: `${edge.source}>${edge.target}.${edge.input}`,
    source: edge.source,
    target: edge.target,
    sourceHandle: "out",
    targetHandle: edge.input,
    // A wire that carries a number is drawn apart from the ones that carry a picture
    class: inputParam(edge.input) === undefined ? undefined : "value",
  };
}

export function toPatchEdge(edge: {
  source: string;
  target: string;
  targetHandle?: string | null;
}): PatchEdge {
  const handle = edge.targetHandle ?? "in";
  const input: InputName =
    handle === "by" || inputParam(handle) !== undefined ? (handle as InputName) : "in";
  return { source: edge.source, target: edge.target, input };
}

export function toPatch(nodes: FlowNode[], edges: FlowEdge[]): Patch {
  return {
    nodes: nodes.map(({ id, data }) => ({
      id,
      fn: data.fn,
      params: data.params,
      option: data.option,
      media: data.media,
    })),
    edges: edges.map(toPatchEdge),
  };
}

export function fromSaved(saved: SavedPatch): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes = saved.nodes.map(({ id, x, y, ...data }): FlowNode => {
    return { id, type: "hydra", position: { x, y }, data };
  });
  return { nodes, edges: saved.edges.map(toFlowEdge) };
}

export function toSaved(
  nodes: FlowNode[],
  edges: FlowEdge[],
  shown: Shown,
  audio: AudioSettings = AUDIO_DEFAULTS,
): SavedPatch {
  const saved = nodes.map(({ id, position, data }): SavedNode => {
    const node: SavedNode = {
      id,
      fn: data.fn,
      params: data.params,
      x: Math.round(position.x),
      y: Math.round(position.y),
    };
    if (data.option !== undefined) node.option = data.option;
    if (data.media) node.media = data.media;
    if (data.collapsed) node.collapsed = true;
    if (data.preview) node.preview = true;
    if (data.more) node.more = true;
    return node;
  });
  const patch: SavedPatch = { v: 1, nodes: saved, edges: edges.map(toPatchEdge), shown };
  // hydra's own settings go without saying, so a patch that never touched them saves as before
  if (!sameAudio(audio, AUDIO_DEFAULTS)) patch.audio = audio;
  return patch;
}

export function defOf(node: FlowNode): NodeDef | undefined {
  return getDef(node.data.fn);
}
