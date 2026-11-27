import { describe, expect, test } from "bun:test";

import { compile, toCode } from "../lib/graph/compile";
import { formatNumber } from "../lib/graph/params";
import { parsePatch } from "../lib/graph/storage";
import { getDef } from "../lib/hydra/catalog";
import { codeHtml, fillOf, heroPatch, wirePath } from "./hero";

const page = await Bun.file(new URL("../../index.html", import.meta.url)).text();

/** The page's text inside an element, tags dropped */
const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

describe("the patch behind the landing page", () => {
  test("opens in the editor as it is, since it is a patch the editor reads", () => {
    expect(parsePatch(JSON.parse(JSON.stringify(heroPatch())))).toEqual(heroPatch());
  });

  test("is shown as code on the page before the page's script runs", () => {
    const sketch = page.match(/<pre class="sketch-code" data-sketch>([\s\S]*?)<\/pre>/);
    expect(sketch).not.toBeNull();
    const patch = heroPatch();
    expect(textOf(sketch?.[1] ?? "")).toBe(toCode(compile(patch), patch.shown));
  });

  test("has every number the hero shows, at the value it shows", () => {
    const patch = heroPatch();
    const nodes = [
      ...page.matchAll(
        /<div class="pnode" data-node="(\w+)"[\s\S]*?(?=<div class="pnode"|<\/div>\s*<p class="patch-msg")/g,
      ),
    ];
    expect(nodes.map((match) => match[1])).toEqual(patch.nodes.map((node) => node.id));
    for (const [markup, id] of nodes) {
      const node = patch.nodes.find((candidate) => candidate.id === id);
      const def = getDef(node?.fn ?? "");
      for (const [, name, shown] of markup.matchAll(
        /data-param="(\w+)"[\s\S]*?<span class="pval">([^<]*)<\/span>/g,
      )) {
        expect(def?.params.some((param) => param.name === name)).toBe(true);
        expect(shown).toBe(formatNumber(node?.params[name]?.value ?? Number.NaN));
      }
    }
  });

  test("has a preview where the page draws one", () => {
    const previews = [...page.matchAll(/data-preview="(\w+)"/g)].map((match) => match[1]);
    expect(previews).toEqual(
      heroPatch()
        .nodes.filter((node) => node.preview)
        .map((node) => node.id),
    );
  });
});

describe("the hero's rows", () => {
  test("fill from zero, as the editor's do", () => {
    expect(fillOf(0.5, 0, 1)).toEqual({ left: 0, width: 50 });
    expect(fillOf(-0.5, -1, 1)).toEqual({ left: 25, width: 25 });
    expect(fillOf(80, 0, 50)).toEqual({ left: 0, width: 100 });
  });
});

describe("the hero's wires", () => {
  test("leave a socket to the right and arrive from the left", () => {
    expect(wirePath(0, 0, 200, 0)).toBe("M0 0C100 0 100 0 200 0");
    expect(wirePath(300, 10, 20, 200)).toBe("M300 10C440 10 -120 200 20 200");
  });

  test("going back to the next row, run along the gap above it instead of across the nodes", () => {
    expect(wirePath(300, 10, 20, 200, 180)).toBe(
      "M300 10C316 10 316 180 300 180L20 180C4 180 4 200 20 200",
    );
  });
});

describe("code on the page", () => {
  test("marks numbers, not the digits in a name", () => {
    expect(codeHtml("noise(2.4, -0.08)\n  .out(o0)")).toBe(
      '<span class="cb">noise(<span class="tn">2.4</span>, <span class="tn">-0.08</span>)</span>\n' +
        '<span class="cb">  .out(o0)</span>',
    );
  });
});
