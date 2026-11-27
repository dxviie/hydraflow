import { describe, expect, test } from "bun:test";

import { connect, downstream, insertAfter, insertOnEdge, removeNode, wouldCycle } from "./edit";
import type { PatchEdge } from "./types";

const chain: PatchEdge[] = [
  { source: "osc", target: "kaleid", input: "in" },
  { source: "kaleid", target: "modulate", input: "in" },
  { source: "noise", target: "modulate", input: "by" },
  { source: "modulate", target: "out", input: "in" },
];

describe("wouldCycle", () => {
  test("refuses a wire back into its own chain, and into itself", () => {
    expect(wouldCycle(chain, "osc", "modulate")).toBe(false);
    expect(wouldCycle(chain, "modulate", "kaleid")).toBe(true);
    expect(wouldCycle(chain, "out", "kaleid")).toBe(true);
    expect(wouldCycle(chain, "noise", "noise")).toBe(true);
    expect(wouldCycle(chain, "noise", "kaleid")).toBe(false);
  });
});

describe("connect", () => {
  test("replaces the wire already in that input, and only that one", () => {
    const edges = connect(chain, { source: "osc", target: "modulate", input: "by" });
    expect(edges).toHaveLength(4);
    expect(edges).toContainEqual({ source: "osc", target: "modulate", input: "by" });
    expect(edges).not.toContainEqual({ source: "noise", target: "modulate", input: "by" });
    expect(edges).toContainEqual({ source: "kaleid", target: "modulate", input: "in" });
  });
});

describe("removeNode", () => {
  test("closes the gap a transform leaves", () => {
    expect(removeNode(chain, "kaleid")).toEqual([
      { source: "osc", target: "modulate", input: "in" },
      { source: "noise", target: "modulate", input: "by" },
      { source: "modulate", target: "out", input: "in" },
    ]);
  });

  test("continues the main chain, not the mixed-in one", () => {
    expect(removeNode(chain, "modulate")).toEqual([
      { source: "osc", target: "kaleid", input: "in" },
      { source: "kaleid", target: "out", input: "in" },
    ]);
  });

  test("leaves an open input behind a source", () => {
    expect(removeNode(chain, "noise")).toEqual(chain.filter((edge) => edge.source !== "noise"));
  });
});

describe("insertAfter", () => {
  test("joins the chain when it takes over", () => {
    expect(insertAfter(chain, "kaleid", "rotate", true)).toEqual([
      { source: "osc", target: "kaleid", input: "in" },
      { source: "rotate", target: "modulate", input: "in" },
      { source: "noise", target: "modulate", input: "by" },
      { source: "modulate", target: "out", input: "in" },
      { source: "kaleid", target: "rotate", input: "in" },
    ]);
  });

  test("branches off when it doesn't", () => {
    const edges = insertAfter(chain, "kaleid", "out2", false);
    expect(edges).toEqual([...chain, { source: "kaleid", target: "out2", input: "in" }]);
  });
});

describe("insertOnEdge", () => {
  test("splits one wire and keeps which input it went into", () => {
    const edges = insertOnEdge(chain, chain[2], "rotate");
    expect(edges).toHaveLength(5);
    expect(edges).toContainEqual({ source: "noise", target: "rotate", input: "in" });
    expect(edges).toContainEqual({ source: "rotate", target: "modulate", input: "by" });
    expect(edges).not.toContainEqual(chain[2]);
  });
});

describe("downstream", () => {
  test("finds everything a node feeds, and nothing that feeds it", () => {
    expect([...downstream(chain, "kaleid")].sort()).toEqual(["modulate", "out"]);
    expect([...downstream(chain, "noise")].sort()).toEqual(["modulate", "out"]);
    expect(downstream(chain, "out").size).toBe(0);
  });
});
