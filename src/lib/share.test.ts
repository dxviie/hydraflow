import { describe, expect, test } from "bun:test";

import { starterPatch } from "./graph/storage";
import { decodePatch, encodePatch, linkedPatch, shareUrl } from "./share";

const base64Url = (text: string) =>
  btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

describe("a patch as a link", () => {
  test("comes back out as the patch that went in", async () => {
    const patch = starterPatch();
    patch.shown = 2;
    patch.nodes[1].params.nSides = {
      value: 6,
      drive: { mode: "lfo", wave: "tri", rate: 0.5, min: 3, max: 9 },
    };
    patch.nodes.push({
      id: "pic",
      fn: "image",
      x: 10,
      y: 20,
      params: {},
      media: { id: "abc", name: "photo é.png" },
    });
    const encoded = await encodePatch(patch);
    expect(encoded).toMatch(/^1\.[A-Za-z0-9_-]+$/);
    expect(await decodePatch(encoded)).toEqual(patch);
  });

  test("is shorter than the patch it carries", async () => {
    const patch = starterPatch();
    expect((await encodePatch(patch)).length).toBeLessThan(JSON.stringify(patch).length);
  });

  test("rides in the part of the address after the #", async () => {
    const encoded = await encodePatch(starterPatch());
    const url = shareUrl("https://example.org/app?x=1#patch=old", encoded);
    expect(url).toBe(`https://example.org/app?x=1#patch=${encoded}`);
    expect(linkedPatch(new URL(url).hash)).toBe(encoded);
    expect(linkedPatch("#sketch=abc")).toBeUndefined();
    expect(linkedPatch("")).toBeUndefined();
  });

  test("reads a link from a browser that could not pack it", async () => {
    const patch = starterPatch();
    expect(await decodePatch(`0.${base64Url(JSON.stringify(patch))}`)).toEqual(patch);
  });

  test("turns away what is cut short, mistyped or not a patch", async () => {
    const encoded = await encodePatch(starterPatch());
    for (const broken of [
      "",
      "1.",
      "2.abc",
      encoded.slice(0, 40),
      `1.${encoded.slice(2).replace(/[A-Za-z]/g, "!")}`,
      `0.${base64Url("not json")}`,
      `0.${base64Url('{"v":1}')}`,
    ]) {
      expect(await decodePatch(broken)).toBeUndefined();
    }
  });

  test("never runs or keeps anything a patch has no place for", async () => {
    const tampered = {
      ...starterPatch(),
      nodes: [
        { id: "a", fn: "osc", x: 0, y: 0, params: { frequency: { value: "alert(1)" } } },
        { id: "b", fn: "<img onerror=alert(1)>", x: 0, y: 0, params: {} },
      ],
      edges: [],
    };
    const patch = await decodePatch(`0.${base64Url(JSON.stringify(tampered))}`);
    expect(patch?.nodes.map((node) => node.fn)).toEqual(["osc"]);
    expect(patch?.nodes[0].params.frequency).toEqual({ value: 60 });
  });

  test("gives up on a link that unpacks into far more than a patch", async () => {
    const bomb = new Blob([new Uint8Array(3_000_000)])
      .stream()
      .pipeThrough(new CompressionStream("deflate-raw"));
    const packed = new Uint8Array(await new Response(bomb).arrayBuffer());
    const encoded = `1.${base64Url(String.fromCharCode(...packed))}`;
    expect(encoded.length).toBeLessThan(10_000);
    expect(await decodePatch(encoded)).toBeUndefined();
  });
});
