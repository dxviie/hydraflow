/**
 * Changes to a patch's wiring. Each returns new edges and leaves its
 * arguments alone.
 */
import type { InputName, PatchEdge } from "./types";

const sameInput = (edge: PatchEdge, target: string, input: InputName) =>
  edge.target === target && edge.input === input;

/** Would a wire from `source` into `target` close a loop? */
export function wouldCycle(edges: PatchEdge[], source: string, target: string): boolean {
  if (source === target) return true;
  const seen = new Set<string>();
  const stack = [target];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (id === source) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const edge of edges) if (edge.source === id) stack.push(edge.target);
  }
  return false;
}

/** Plug a wire in. An input holds one wire, so a new one replaces the old. */
export function connect(edges: PatchEdge[], edge: PatchEdge): PatchEdge[] {
  return [...edges.filter((other) => !sameInput(other, edge.target, edge.input)), edge];
}

/**
 * Take a node out and close the gap: whatever fed its main input now feeds
 * what it was feeding.
 */
export function removeNode(edges: PatchEdge[], id: string): PatchEdge[] {
  const upstream = edges.find((edge) => sameInput(edge, id, "in"))?.source;
  const kept: PatchEdge[] = [];
  for (const edge of edges) {
    if (edge.target === id) continue;
    if (edge.source !== id) kept.push(edge);
    else if (upstream !== undefined) kept.push({ ...edge, source: upstream });
  }
  return kept;
}

/**
 * Put a new node right after `source`. With `takeOver`, everything `source`
 * fed now comes from the new node: it joins the chain instead of branching.
 */
export function insertAfter(
  edges: PatchEdge[],
  source: string,
  id: string,
  takeOver: boolean,
): PatchEdge[] {
  const moved = takeOver
    ? edges.map((edge) => (edge.source === source ? { ...edge, source: id } : edge))
    : edges;
  return [...moved, { source, target: id, input: "in" }];
}

/** Put a new node into a wire: `source → target` becomes `source → id → target` */
export function insertOnEdge(edges: PatchEdge[], edge: PatchEdge, id: string): PatchEdge[] {
  const rest = edges.filter(
    (other) => !(other.source === edge.source && sameInput(other, edge.target, edge.input)),
  );
  return [
    ...rest,
    { source: edge.source, target: id, input: "in" },
    { source: id, target: edge.target, input: edge.input },
  ];
}

/** Every node a node feeds, directly or further down */
export function downstream(edges: PatchEdge[], id: string): Set<string> {
  const found = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const edge of edges) {
      if (edge.source !== current || found.has(edge.target)) continue;
      found.add(edge.target);
      stack.push(edge.target);
    }
  }
  return found;
}
