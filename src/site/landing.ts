/**
 * The landing page. It reads without this: what this adds is the patch
 * playing behind the page, its numbers to drag in the hero, the same patch
 * as code further down, and links that open it in the editor as it stands.
 *
 * The patch runs on the editor's own engine, so it behaves as it will there:
 * a dragged number reaches hydra without a new shader.
 */
import { compile, toCode } from "../lib/graph/compile";
import { formatNumber } from "../lib/graph/params";
import type { SavedPatch } from "../lib/graph/storage";
import { getDef, type ParamDef } from "../lib/hydra/catalog";
import { Engine } from "../lib/hydra/engine";
import { encodePatch, shareUrl } from "../lib/share";
import { scrub, snap } from "../lib/ui/scrub";
import { APP_PATH, codeHtml, fillOf, heroPatch, wirePath } from "./hero";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const patch: SavedPatch = heroPatch();
let engine: Engine | undefined;
let changed = false;

const nodeById = (id: string) => patch.nodes.find((node) => node.id === id);

/* ── The top bar turns solid once the page scrolls under it ─ */

function watchTop() {
  const top = document.querySelector<HTMLElement>("[data-top]");
  if (!top) return;
  const update = () => top.classList.toggle("is-solid", window.scrollY > 8);
  update();
  window.addEventListener("scroll", update, { passive: true });
}

/* ── The backdrop ─────────────────────────────────────────── */

function startBackdrop() {
  const canvas = document.querySelector<HTMLCanvasElement>("#backdrop");
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  try {
    engine = new Engine(canvas, {
      // The hero's patch plays no files and opens no camera
      loadMedia: async () => undefined,
      onstatus: () => {},
      // Nor does it listen
      onaudio: () => {},
    });
  } catch (error) {
    console.warn("hydra needs WebGL, and this browser didn't give it one", error);
    note("// the visuals need WebGL, which this browser didn't give");
    return;
  }

  engine.setParams(patch.nodes);
  engine.apply(compile(patch));
  engine.show(patch.shown);
  engine.paused = reducedMotion;
  for (const node of patch.nodes) {
    const preview = document.querySelector<HTMLCanvasElement>(`[data-preview="${node.id}"]`);
    if (node.preview && preview) engine.attachPreview(node.id, preview);
  }
  engine.start();
  requestAnimationFrame(() => requestAnimationFrame(() => canvas.classList.add("is-ready")));

  window.addEventListener("resize", () => engine?.resize(window.innerWidth, window.innerHeight));

  const status = document.querySelector<HTMLElement>("[data-status]");
  const toggle = document.querySelector<HTMLButtonElement>("[data-backdrop-toggle]");
  if (status) status.hidden = false;
  if (toggle) {
    const show = () => {
      const paused = engine?.paused ?? false;
      toggle.dataset.state = paused ? "paused" : "playing";
      toggle.setAttribute("aria-pressed", String(paused));
      toggle.setAttribute(
        "aria-label",
        paused ? "Paused, play the background" : "Live, pause the background",
      );
    };
    toggle.addEventListener("click", () => {
      if (!engine) return;
      engine.paused = !engine.paused;
      show();
    });
    show();
  }
}

/* ── The hero's patch ─────────────────────────────────────── */

function note(text: string, tone?: "ok") {
  const line = document.querySelector<HTMLElement>("[data-patch-msg]");
  const span = line?.querySelector<HTMLElement>("[data-patch-note]");
  if (!line || !span) return;
  span.textContent = text;
  if (tone) line.dataset.tone = tone;
  else delete line.dataset.tone;
}

function showRow(row: HTMLElement, def: ParamDef, value: number) {
  const fill = fillOf(value, def.min, def.max);
  const bar = row.querySelector<HTMLElement>(".fill");
  const shown = row.querySelector<HTMLElement>(".pval");
  if (bar) {
    bar.style.left = `${fill.left}%`;
    bar.style.width = `${fill.width}%`;
  }
  if (shown) shown.textContent = formatNumber(value);
  row.setAttribute("aria-valuenow", String(value));
}

function bindRows() {
  for (const row of document.querySelectorAll<HTMLElement>("[data-param]")) {
    const nodeId = row.closest<HTMLElement>("[data-node]")?.dataset.node ?? "";
    const node = nodeById(nodeId);
    const name = row.dataset.param ?? "";
    const def = getDef(node?.fn ?? "")?.params.find((param) => param.name === name);
    const param = node?.params[name];
    if (!node || !def || !param) continue;

    row.setAttribute("aria-valuemin", String(def.min));
    row.setAttribute("aria-valuemax", String(def.max));
    row.title = "drag to change";
    showRow(row, def, param.value);

    const options = {
      value: param.value,
      min: def.min,
      max: def.max,
      step: def.step,
      onchange: (next: number) => set(next),
    };
    const action = scrub(row, options);
    const set = (next: number) => {
      param.value = next;
      options.value = next;
      action?.update?.(options);
      showRow(row, def, next);
      onChange();
    };

    row.addEventListener("keydown", (event) => {
      const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (direction === 0) return;
      event.preventDefault();
      const next = snap(param.value + direction * def.step * (event.shiftKey ? 10 : 1), def.step);
      set(Math.min(def.max, Math.max(def.min, next)));
    });
  }
}

/** The wires between the hero's nodes, wherever the layout put them */
function drawWires() {
  const body = document.querySelector<HTMLElement>("[data-patch-body]");
  const svg = document.querySelector<SVGSVGElement>("[data-patch-wires]");
  if (!body || !svg) return;
  const draw = () => {
    const origin = body.getBoundingClientRect();
    const centre = (element: Element | null | undefined) => {
      const box = element?.getBoundingClientRect();
      return (
        box && {
          x: box.left + box.width / 2 - origin.left,
          y: box.top + box.height / 2 - origin.top,
        }
      );
    };
    const halfGap = Number.parseFloat(getComputedStyle(body).rowGap) / 2 || 0;
    const paths = patch.edges.map((edge) => {
      const target = body.querySelector(`[data-node="${edge.target}"]`);
      const from = centre(body.querySelector(`[data-node="${edge.source}"] .sock-out`));
      const to = centre(target?.querySelector(".sock-in"));
      if (!from || !to || !target) return "";
      const lane = target.getBoundingClientRect().top - origin.top - halfGap;
      return `<path d="${wirePath(from.x, from.y, to.x, to.y, lane)}"/>`;
    });
    svg.innerHTML = paths.join("");
  };
  draw();
  new ResizeObserver(draw).observe(body);
}

/* ── The same patch, as code and as a link ────────────────── */

function showCode(flash: boolean) {
  const view = document.querySelector<HTMLElement>("[data-sketch]");
  if (!view) return;
  view.innerHTML = codeHtml(toCode(compile(patch), patch.shown));
  if (!flash) return;
  view.classList.add("is-changed");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => view.classList.remove("is-changed"), 180);
}
let flashTimer: ReturnType<typeof setTimeout> | undefined;

let linkTimer: ReturnType<typeof setTimeout> | undefined;
function updateLinks() {
  clearTimeout(linkTimer);
  linkTimer = setTimeout(async () => {
    const editor = new URL(APP_PATH, window.location.href).href;
    const url = shareUrl(editor, await encodePatch(patch));
    for (const link of document.querySelectorAll<HTMLAnchorElement>("[data-patch-open]")) {
      link.href = url;
    }
  }, 120);
}

function onChange() {
  engine?.setParams(patch.nodes);
  showCode(true);
  updateLinks();
  if (!changed) {
    changed = true;
    note("// that's the whole idea. open it to add more boxes", "ok");
    const modified = document.querySelector<HTMLElement>("[data-modified]");
    if (modified) modified.hidden = false;
  }
}

watchTop();
bindRows();
drawWires();
showCode(false);
updateLinks();
startBackdrop();
