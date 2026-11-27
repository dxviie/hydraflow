import { describe, expect, test } from "bun:test";

import glslFunctions from "hydra-synth/src/glsl/glsl-functions.js";
import { getDef, NODE_DEFS } from "./catalog";

describe("the node catalog", () => {
  test("has a node for every texture function hydra ships", () => {
    const kinds = new Set(["src", "coord", "color", "combine", "combineCoord"]);
    const special = new Set(["src", "prev", "sum"]);
    const hydra = (glslFunctions() as { name: string; type: string }[])
      .filter((fn) => kinds.has(fn.type) && !special.has(fn.name))
      .map((fn) => fn.name);
    expect(hydra.length).toBeGreaterThan(40);
    for (const name of hydra) expect(getDef(name)?.type).toBe(name);
  });

  test("knows how many textures each kind takes", () => {
    expect(getDef("osc")).toMatchObject({ category: "source", inputs: 0 });
    expect(getDef("kaleid")).toMatchObject({ category: "geometry", inputs: 1 });
    expect(getDef("hue")).toMatchObject({ category: "color", inputs: 1 });
    expect(getDef("blend")).toMatchObject({ category: "blend", inputs: 2 });
    expect(getDef("modulate")).toMatchObject({ category: "modulate", inputs: 2 });
    expect(getDef("out")).toMatchObject({ inputs: 1, hasOutput: false });
    expect(getDef("src")).toMatchObject({ inputs: 0, options: ["o0", "o1", "o2", "o3"] });
    expect(getDef("cam")).toMatchObject({ category: "input", inputs: 0 });
  });

  test("takes hydra's own parameters and defaults", () => {
    expect(getDef("osc")?.params).toEqual([
      { name: "frequency", default: 60, min: 0, max: 200, step: 0.1 },
      { name: "sync", default: 0.1, min: -1, max: 1, step: 0.01 },
      { name: "offset", default: 0, min: 0, max: 3.14, step: 0.01 },
    ]);
  });

  test("gives every node a description and every parameter a range to scrub in", () => {
    for (const def of NODE_DEFS) {
      expect(def.doc, def.type).not.toBe("");
      expect(def.primary, def.type).toBeLessThanOrEqual(def.params.length);
      for (const param of def.params) {
        expect(param.min, `${def.type}.${param.name}`).toBeLessThan(param.max);
        expect(param.step, `${def.type}.${param.name}`).toBeGreaterThan(0);
        expect(Number.isFinite(param.default), `${def.type}.${param.name}`).toBe(true);
      }
    }
  });
});
