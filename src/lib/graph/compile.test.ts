import { describe, expect, test } from "bun:test";

import { getDef } from "../hydra/catalog";
import { buildChain, compile, nodeCode, signature, toCode } from "./compile";
import { starterPatch } from "./storage";
import type { Patch, PatchNode } from "./types";

const node = (
  id: string,
  fn: string,
  values: Record<string, number> = {},
  option?: number,
): PatchNode => {
  const params = Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, { value }]),
  );
  return { id, fn, params, option };
};

describe("toCode", () => {
  test("writes the starter patch as a hydra sketch", () => {
    expect(toCode(compile(starterPatch()))).toBe(
      [
        "osc(40, 0.06)",
        "  .kaleid(6)",
        "  .modulate(noise(3), 0.25)",
        "  .color(0.56, 0.1)",
        "  .out(o0)",
      ].join("\n"),
    );
  });

  test("leaves trailing defaults off, but not ones before a changed value", () => {
    const patch: Patch = {
      nodes: [node("a", "osc", { frequency: 60, sync: 0.1, offset: 1 }), node("o", "out")],
      edges: [{ source: "a", target: "o", input: "in" }],
    };
    expect(toCode(compile(patch))).toBe("osc(60, 0.1, 1)\n  .out(o0)");
  });

  test("fills an input nothing is plugged into with transparent black", () => {
    const patch: Patch = {
      nodes: [node("k", "kaleid"), node("b", "blend"), node("o", "out", {}, 1)],
      edges: [
        { source: "k", target: "b", input: "in" },
        { source: "b", target: "o", input: "in" },
      ],
    };
    expect(toCode(compile(patch))).toBe(
      "solid(0, 0, 0, 0)\n  .kaleid()\n  .blend(solid(0, 0, 0, 0))\n  .out(o1)",
    );
  });

  test("breaks a long mixed-in chain over lines", () => {
    const patch: Patch = {
      nodes: [
        node("a", "osc"),
        node("n", "noise"),
        node("r", "rotate", { angle: 1 }),
        node("k", "kaleid"),
        node("m", "modulate"),
        node("o", "out"),
      ],
      edges: [
        { source: "n", target: "r", input: "in" },
        { source: "r", target: "k", input: "in" },
        { source: "a", target: "m", input: "in" },
        { source: "k", target: "m", input: "by" },
        { source: "m", target: "o", input: "in" },
      ],
    };
    expect(toCode(compile(patch))).toBe(
      [
        "osc()",
        "  .modulate(",
        "    noise()",
        "      .rotate(1)",
        "      .kaleid()",
        "  )",
        "  .out(o0)",
      ].join("\n"),
    );
  });

  test("writes driven parameters the way hydra takes them", () => {
    const osc = node("a", "osc");
    osc.params.frequency = {
      value: 60,
      drive: { mode: "seq", values: [20, 40, 80], fast: 0.5, smooth: true },
    };
    osc.params.sync = { value: 0.1, drive: { mode: "audio", bin: 2, min: 0, max: 1 } };
    const patch: Patch = {
      nodes: [osc, node("o", "out")],
      edges: [{ source: "a", target: "o", input: "in" }],
    };
    expect(toCode(compile(patch))).toBe(
      "osc([20, 40, 80].fast(0.5).smooth(), () => a.fft[2])\n  .out(o0)",
    );
  });

  test("starts the cameras and reads feedback from the buffers", () => {
    const patch: Patch = {
      nodes: [
        node("c1", "cam", {}, 1),
        node("c2", "cam"),
        node("f", "src", {}, 2),
        node("d", "diff"),
        node("b", "blend"),
        node("o", "out"),
      ],
      edges: [
        { source: "c1", target: "d", input: "in" },
        { source: "c2", target: "d", input: "by" },
        { source: "d", target: "b", input: "in" },
        { source: "f", target: "b", input: "by" },
        { source: "b", target: "o", input: "in" },
      ],
    };
    expect(toCode(compile(patch), 2)).toBe(
      [
        "s0.initCam(1)",
        "s1.initCam(0)",
        "",
        "src(s0)",
        "  .diff(src(s1))",
        "  .blend(src(o2))",
        "  .out(o0)",
        "",
        "render(o2)",
      ].join("\n"),
    );
  });
});

describe("inputs", () => {
  const inputs: Patch = {
    nodes: [
      node("screen", "screen"),
      { ...node("pic", "image"), media: { id: "m1", name: 'my "pic".png' } },
      node("clip", "video"),
      node("cam", "cam", {}, 2),
      { ...node("fifth", "image"), media: { id: "m2", name: "late.png" } },
      node("o", "out"),
    ],
    edges: [{ source: "fifth", target: "o", input: "in" }],
  };

  test("each takes one of hydra's four inputs, in patch order", () => {
    expect(compile(inputs).sources).toEqual([
      { nodeId: "screen", kind: "screen", slot: 0, device: 0 },
      { nodeId: "pic", kind: "image", slot: 1, device: 0, media: inputs.nodes[1].media },
      { nodeId: "clip", kind: "video", slot: 2, device: 0 },
      { nodeId: "cam", kind: "cam", slot: 3, device: 2 },
    ]);
  });

  test("a fifth draws nothing: hydra has no input left for it", () => {
    const compiled = compile(inputs);
    expect(compiled.exprOf("fifth")).toEqual({ kind: "empty" });
    expect(compiled.exprOf("cam")).toEqual({ kind: "buffer", name: "s3" });
  });

  test("start in code the way hydra starts them, files by their name in a media folder", () => {
    expect(toCode(compile(inputs))).toBe(
      [
        "s0.initScreen()",
        's1.initImage("/media/my \\"pic\\".png")',
        "s3.initCam(2)",
        "",
        "solid(0, 0, 0, 0)",
        "  .out(o0)",
      ].join("\n"),
    );
  });

  test("picking another file is a change hydra has to hear about", () => {
    const other = structuredClone(inputs);
    other.nodes[1].media = { id: "m9", name: 'my "pic".png' };
    expect(signature(other)).not.toBe(signature(inputs));
  });
});

describe("compile", () => {
  test("a loop draws nothing instead of recursing forever", () => {
    const patch: Patch = {
      nodes: [node("a", "kaleid"), node("b", "rotate"), node("o", "out")],
      edges: [
        { source: "a", target: "b", input: "in" },
        { source: "b", target: "a", input: "in" },
        { source: "b", target: "o", input: "in" },
      ],
    };
    expect(toCode(compile(patch))).toContain("solid(0, 0, 0, 0)");
  });

  test("an out node shows what goes into it", () => {
    const compiled = compile(starterPatch());
    expect(compiled.exprOf("out")).toBe(compiled.exprOf("color"));
    expect(compiled.outputs).toEqual([
      { nodeId: "out", buffer: 0, expr: compiled.exprOf("color") },
    ]);
  });
});

describe("signature", () => {
  test("stays the same while a value is scrubbed", () => {
    const patch = starterPatch();
    const before = signature(patch);
    patch.nodes[0].params.frequency = { value: 12 };
    patch.nodes[0].params.sync = {
      value: 0,
      drive: { mode: "lfo", wave: "saw", rate: 1, min: 0, max: 1 },
    };
    expect(signature(patch)).toBe(before);
  });

  test("changes with the wiring, the nodes and their buffers", () => {
    const patch = starterPatch();
    const before = signature(patch);
    expect(signature({ ...patch, edges: patch.edges.slice(1) })).not.toBe(before);
    expect(signature({ ...patch, nodes: patch.nodes.slice(1) })).not.toBe(before);
    const moved = patch.nodes.map((n) => (n.fn === "out" ? { ...n, option: 1 } : n));
    expect(signature({ ...patch, nodes: moved })).not.toBe(before);
  });
});

describe("nodeCode", () => {
  test("reads like the line of code the node stands for", () => {
    const patch = starterPatch();
    const line = (id: string) => {
      const found = patch.nodes.find((n) => n.id === id) as PatchNode;
      return nodeCode(found, getDef(found.fn) as NonNullable<ReturnType<typeof getDef>>);
    };
    expect(line("osc")).toBe("osc(40, 0.06)");
    expect(line("modulate")).toBe("modulate(…, 0.25)");
    expect(line("out")).toBe("out(o0)");
  });
});

describe("buildChain", () => {
  test("calls hydra in chain order, with every parameter as a function", () => {
    const calls: string[] = [];
    const chain = (label: string): Record<string, unknown> =>
      new Proxy(
        { label },
        {
          get: (target, name) =>
            name === "label"
              ? target.label
              : (...args: unknown[]) => {
                  const shown = args.map((arg) =>
                    typeof arg === "function" ? arg() : (arg as { label: string }).label,
                  );
                  calls.push(`${target.label}.${String(name)}(${shown.join(", ")})`);
                  return chain(`${String(name)}`);
                },
        },
      );
    const compiled = compile(starterPatch());
    buildChain(compiled.exprOf("out"), {
      synth: chain("synth"),
      arg: (n, name, fallback) => () => n.params[name]?.value ?? fallback,
    });
    expect(calls).toEqual([
      "synth.osc(40, 0.06, 0)",
      "osc.kaleid(6)",
      "synth.noise(3, 0.1)",
      "kaleid.modulate(noise, 0.25)",
      "modulate.color(0.56, 0.1, 1, 1)",
    ]);
  });
});
