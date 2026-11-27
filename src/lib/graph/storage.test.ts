import { describe, expect, test } from "bun:test";

import { AUDIO_DEFAULTS } from "./audio";
import { parsePatch, starterPatch, withinBands } from "./storage";

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

  test("keeps the name of a file, only on nodes that play one", () => {
    const patch = reparse({
      v: 1,
      nodes: [
        { id: "a", fn: "image", media: { id: "m1", name: "photo.png", blob: "data:..." } },
        { id: "b", fn: "video", media: { id: "", name: "clip.mp4" } },
        { id: "c", fn: "image", media: "photo.png" },
        { id: "d", fn: "osc", media: { id: "m1", name: "photo.png" } },
        { id: "e", fn: "image", media: { id: "m2", name: "n".repeat(500) } },
      ],
    });
    expect(patch?.nodes.map((node) => node.media)).toEqual([
      { id: "m1", name: "photo.png" },
      undefined,
      undefined,
      undefined,
      { id: "m2", name: "n".repeat(200) },
    ]);
  });

  test("keeps a control's wire into a parameter, and nothing that only looks like one", () => {
    const patch = reparse({
      v: 1,
      nodes: [
        {
          id: "l",
          fn: "lfo",
          option: 2,
          params: { rate: { value: 1, drive: { mode: "mouse", axis: "x", min: 0, max: 1 } } },
        },
        { id: "m", fn: "audio" },
        { id: "a", fn: "osc" },
        { id: "k", fn: "kaleid" },
      ],
      edges: [
        { source: "l", target: "k", input: "p:nSides" },
        { source: "m", target: "a", input: "p:sync" },
        { source: "a", target: "k", input: "p:nSides" },
        { source: "l", target: "k", input: "p:notThere" },
        { source: "l", target: "m", input: "p:min" },
        { source: "l", target: "k", input: "in" },
        { source: "m", target: "a", input: "p:sync " },
      ],
    });
    expect(patch?.edges).toEqual([
      { source: "l", target: "k", input: "p:nSides" },
      { source: "m", target: "a", input: "p:sync" },
    ]);
    // A control's own settings stay plain numbers
    expect(patch?.nodes[0]).toMatchObject({
      option: 2,
      params: { rate: { value: 1 }, min: { value: 0 }, max: { value: 1 } },
    });
  });

  test("keeps which output plays, or that all four do", () => {
    expect(reparse({ v: 1, nodes: [], shown: "all" })?.shown).toBe("all");
    expect(reparse({ v: 1, nodes: [], shown: 3 })?.shown).toBe(3);
    for (const shown of [7, "some", null, 1.5]) {
      expect(reparse({ v: 1, nodes: [], shown })?.shown).toBe(0);
    }
  });

  test("keeps how the sound is read, held to what it can be read with", () => {
    const audio = { bins: 6, cutoff: 1, smooth: 0.8, scale: 4 };
    expect(reparse({ v: 1, nodes: [], audio })?.audio).toEqual(audio);
    expect(
      reparse({ v: 1, nodes: [], audio: { bins: 99, smooth: "fast", extra: 1 } })?.audio,
    ).toEqual({ ...AUDIO_DEFAULTS, bins: 8 });
  });

  test("says nothing about the sound when it is read hydra's own way", () => {
    for (const audio of [undefined, AUDIO_DEFAULTS, "loud", { bins: "many" }]) {
      const patch = reparse({ v: 1, nodes: [], audio });
      expect(patch && "audio" in patch).toBe(false);
    }
  });

  test("moves what listens to a band the sound isn't cut into onto the last band there is", () => {
    const drive = (bin: number) => ({ mode: "audio" as const, bin, min: 0, max: 1 });
    const nodes = [
      { id: "m", fn: "audio", option: 5 },
      { id: "a", fn: "osc", params: { sync: { value: 0.1, drive: drive(7) } } },
      { id: "b", fn: "osc", params: { sync: { value: 0.1, drive: drive(8) } } },
    ];
    const six = reparse({ v: 1, nodes, audio: { bins: 6 } });
    expect(six?.nodes[0].option).toBe(5);
    expect(six?.nodes[1].params.sync.drive).toEqual(drive(5));
    // A band no patch can have was never a drive
    expect(six?.nodes[2].params.sync).toEqual({ value: 0.1 });
    // Without a word about the sound there are hydra's four
    const four = reparse({ v: 1, nodes });
    expect(four?.nodes[0].option).toBe(3);
    expect(four?.nodes[1].params.sync.drive).toEqual(drive(3));
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

describe("withinBands", () => {
  const listening = {
    fn: "osc",
    params: {
      frequency: { value: 60 },
      sync: { value: 0.1, drive: { mode: "audio" as const, bin: 5, min: 0, max: 1 } },
    },
  };

  test("leaves a node that fits exactly as it was", () => {
    expect(withinBands(listening, 6)).toBe(listening);
    const band = { fn: "audio", params: {}, option: 3 };
    expect(withinBands(band, 4)).toBe(band);
    // Only an audio node's option is a band
    const wave = { fn: "lfo", params: {}, option: 3 };
    expect(withinBands(wave, 2)).toBe(wave);
  });

  test("moves a drive and an audio node onto the last band, and keeps the rest", () => {
    const fitted = withinBands(listening, 4);
    expect(fitted.params.sync).toEqual({
      value: 0.1,
      drive: { mode: "audio", bin: 3, min: 0, max: 1 },
    });
    expect(fitted.params.frequency).toBe(listening.params.frequency);
    expect(listening.params.sync.drive.bin).toBe(5);
    expect(withinBands({ fn: "audio", params: {}, option: 3 }, 2).option).toBe(1);
  });
});
