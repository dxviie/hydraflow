import { describe, expect, test } from "bun:test";

import { fromSaved, newNode, toFlowEdge, toPatch, toPatchEdge, toSaved } from "./flow";
import { AUDIO_DEFAULTS } from "./graph/audio";
import { parsePatch, starterPatch } from "./graph/storage";
import { getDef, type NodeDef } from "./hydra/catalog";

const save = (from: unknown) => {
  const loaded = parsePatch(from);
  if (!loaded) throw new Error("the patch did not parse");
  const { nodes, edges } = fromSaved(loaded);
  return toSaved(nodes, edges, loaded.shown, loaded.audio);
};

describe("a patch in Svelte Flow", () => {
  // Undo relies on this: restoring a snapshot must not look like a new change
  test("saves back as exactly what it was loaded from", () => {
    const patch = starterPatch();
    patch.shown = 1;
    patch.nodes[0].collapsed = true;
    patch.nodes[2].more = true;
    patch.nodes[1].params.nSides = {
      value: 6,
      drive: { mode: "seq", values: [4, 8], fast: 2, smooth: true },
    };
    patch.nodes[3].params.amount = {
      value: 0.25,
      drive: { mode: "audio", bin: 1, min: 0, max: 0.5 },
    };
    const saved = save(patch);
    expect(saved).toEqual(patch);
    const text = JSON.stringify(saved);
    expect(JSON.stringify(save(JSON.parse(text)))).toBe(text);
  });

  test("saves back how the sound is read and that all outputs show, as it was loaded", () => {
    const patch = starterPatch();
    patch.shown = "all";
    patch.audio = { bins: 6, cutoff: 1.5, smooth: 0.8, scale: 4 };
    patch.nodes[3].params.amount = {
      value: 0.25,
      drive: { mode: "audio", bin: 5, min: 0, max: 0.5 },
    };
    const saved = save(patch);
    expect(saved).toEqual(patch);
    const text = JSON.stringify(saved);
    expect(JSON.stringify(save(JSON.parse(text)))).toBe(text);
  });

  test("a patch that leaves the sound alone saves as it did before there were settings", () => {
    const { nodes, edges } = fromSaved(starterPatch());
    expect("audio" in toSaved(nodes, edges, 0)).toBe(false);
    expect("audio" in toSaved(nodes, edges, 0, { ...AUDIO_DEFAULTS })).toBe(false);
  });

  test("hands the compiler the graph without the layout", () => {
    const { nodes, edges } = fromSaved(starterPatch());
    const patch = toPatch(nodes, edges);
    expect(patch.nodes[0]).toEqual({
      id: "osc",
      fn: "osc",
      params: { frequency: { value: 40 }, sync: { value: 0.06 }, offset: { value: 0 } },
      option: undefined,
    });
    expect(patch.edges).toContainEqual({ source: "noise", target: "modulate", input: "by" });
  });

  test("a wire into a parameter keeps its parameter, and is marked as carrying a number", () => {
    const wire = toFlowEdge({ source: "lfo", target: "kaleid", input: "p:nSides" });
    expect(wire).toMatchObject({ targetHandle: "p:nSides", class: "value" });
    expect(toPatchEdge(wire)).toEqual({ source: "lfo", target: "kaleid", input: "p:nSides" });
    expect(toFlowEdge({ source: "osc", target: "kaleid", input: "in" }).class).toBeUndefined();
    expect(toPatchEdge({ source: "a", target: "b", targetHandle: "sideways" }).input).toBe("in");
  });

  test("a new node starts from hydra's defaults", () => {
    const osc = newNode(getDef("osc") as NodeDef, { x: 10, y: 20 });
    expect(osc.data).toEqual({
      fn: "osc",
      params: { frequency: { value: 60 }, sync: { value: 0.1 }, offset: { value: 0 } },
    });
    expect(newNode(getDef("out") as NodeDef, { x: 0, y: 0 }).data.option).toBe(0);
  });
});
