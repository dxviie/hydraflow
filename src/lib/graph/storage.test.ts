import { describe, expect, test } from "bun:test";

import { parsePatch, starterPatch } from "./storage";

const reparse = (patch: unknown) => parsePatch(JSON.parse(JSON.stringify(patch)));

describe("parsePatch", () => {
  test("reads back what was saved", () => {
    const patch = starterPatch();
    patch.nodes[0].collapsed = true;
    patch.nodes[1].preview = true;
    patch.nodes[1].params.nSides = {
      value: 6,
      drive: { mode: "lfo", wave: "sine", rate: 0.2, min: 4, max: 8 },
    };
    patch.shown = 2;
    expect(reparse(patch)).toEqual(patch);
  });

  test("turns away what isn't a patch", () => {
    for (const junk of [null, 3, "patch", [], {}, { v: 2, nodes: [] }, { v: 1 }]) {
      expect(parsePatch(junk)).toBeUndefined();
    }
  });

  test("drops nodes it doesn't know, and the wires to them", () => {
    const patch = reparse({
      v: 1,
      nodes: [
        { id: "a", fn: "osc", x: 0, y: 0 },
        { id: "b", fn: "notAFunction", x: 0, y: 0 },
        { id: "a", fn: "noise", x: 0, y: 0 },
        { id: "o", fn: "out", x: 0, y: 0, option: 9 },
      ],
      edges: [
        { source: "a", target: "b", input: "in" },
        { source: "b", target: "o", input: "in" },
        { source: "a", target: "o", input: "in" },
      ],
    });
    expect(patch?.nodes.map((node) => `${node.id}:${node.fn}:${node.option}`)).toEqual([
      "a:osc:undefined",
      "o:out:0",
    ]);
    expect(patch?.edges).toEqual([{ source: "a", target: "o", input: "in" }]);
  });

  test("fills in parameters and refuses values that aren't numbers", () => {
    const patch = reparse({
      v: 1,
      nodes: [
        {
          id: "a",
          fn: "osc",
          params: {
            frequency: { value: "alert(1)" },
            sync: { value: 0.5, drive: { mode: "fn", code: "alert(1)" } },
            offset: { value: 1, drive: { mode: "seq", values: [1, "x", 2], fast: 2 } },
            extra: { value: 1 },
          },
        },
      ],
    });
    expect(patch?.nodes[0].params).toEqual({
      frequency: { value: 60 },
      sync: { value: 0.5 },
      offset: { value: 1, drive: { mode: "seq", values: [1, 2], fast: 2, smooth: false } },
    });
  });

  test("drops wires that close a loop, go nowhere, or come out of an out", () => {
    const patch = reparse({
      v: 1,
      nodes: [
        { id: "a", fn: "kaleid" },
        { id: "b", fn: "rotate" },
        { id: "o", fn: "out" },
      ],
      edges: [
        { source: "a", target: "b", input: "in" },
        { source: "b", target: "a", input: "in" },
        { source: "a", target: "b", input: "by" },
        { source: "o", target: "a", input: "in" },
        { source: "b", target: "o", input: "sideways" },
      ],
    });
    expect(patch?.edges).toEqual([{ source: "a", target: "b", input: "in" }]);
  });
});
