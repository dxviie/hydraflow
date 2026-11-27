/**
 * The patch that plays behind the landing page: small enough to show whole
 * in the hero, and a real patch, so it opens in the editor as it stands.
 */
import type { SavedPatch } from "../lib/graph/storage";
import type { ParamState } from "../lib/graph/types";

const value = (number: number): ParamState => ({ value: number });

export function heroPatch(): SavedPatch {
  return {
    v: 1,
    shown: 0,
    nodes: [
      {
        id: "noise",
        fn: "noise",
        x: 0,
        y: 40,
        params: { scale: value(2.4), offset: value(0.08) },
        preview: true,
      },
      { id: "kaleid", fn: "kaleid", x: 290, y: 40, params: { nSides: value(5) } },
      {
        id: "color",
        fn: "color",
        x: 580,
        y: 40,
        params: { r: value(0.56), g: value(0.1), b: value(1), a: value(1) },
      },
      { id: "out", fn: "out", x: 870, y: 40, params: {}, option: 0 },
    ],
    edges: [
      { source: "noise", target: "kaleid", input: "in" },
      { source: "kaleid", target: "color", input: "in" },
      { source: "color", target: "out", input: "in" },
    ],
  };
}

/** Where the editor lives, next to this page */
export const APP_PATH = "/app";

/** Where a row's bar starts and how wide it is, in %: from zero, as in the editor */
export function fillOf(value: number, min: number, max: number): { left: number; width: number } {
  const place = (at: number) => Math.min(1, Math.max(0, (at - min) / (max - min))) * 100;
  const zero = place(0);
  const at = place(value);
  return { left: Math.min(zero, at), width: Math.abs(at - zero) };
}

/**
 * A wire from an out socket to an in socket, curving the way the editor's do.
 * One that goes back to the left turns down into `lane`, the gap above its
 * target, instead of cutting across the nodes on its way.
 */
export function wirePath(sx: number, sy: number, tx: number, ty: number, lane?: number): string {
  const r = (n: number) => Math.round(n * 10) / 10;
  if (tx < sx && lane !== undefined) {
    const turn = 16;
    return (
      `M${r(sx)} ${r(sy)}C${r(sx + turn)} ${r(sy)} ${r(sx + turn)} ${r(lane)} ${r(sx)} ${r(lane)}` +
      `L${r(tx)} ${r(lane)}C${r(tx - turn)} ${r(lane)} ${r(tx - turn)} ${r(ty)} ${r(tx)} ${r(ty)}`
    );
  }
  const reach = Math.max(Math.abs(tx - sx) / 2, 48);
  return `M${r(sx)} ${r(sy)}C${r(sx + reach)} ${r(sy)} ${r(tx - reach)} ${r(ty)} ${r(tx)} ${r(ty)}`;
}

const escapeHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** hydra code as the page shows it: one highlight per line, numbers in violet */
export function codeHtml(code: string): string {
  return code
    .split("\n")
    .map((line) => {
      const marked = escapeHtml(line).replace(
        /(^|[^\w.])(-?\d+(?:\.\d+)?)/g,
        (_, before: string, number: string) => `${before}<span class="tn">${number}</span>`,
      );
      return `<span class="cb">${marked}</span>`;
    })
    .join("\n");
}
