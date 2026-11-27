/**
 * The hydra instance behind the editor. A compiled patch goes in; hydra draws
 * it on the canvas, and draws the texture of any node that asked for a
 * preview into that node's own small canvas.
 *
 * Parameters reach hydra as functions it calls every frame, so scrubbing a
 * value never recompiles a shader: only a change of wiring does.
 */
import Hydra from "hydra-synth";

import { buildChain, type Chain, type Compiled, type Expr, type Source } from "../graph/compile";
import { controlDrive, type Env, evalDrive, evalParam } from "../graph/params";
import type { Drive, ParamState, PatchNode } from "../graph/types";
import { getDef, MAX_SOURCES } from "./catalog";
import { type OpenInput, openCamera, openImage, openScreen, openVideo } from "./inputs";

export const PREVIEW_WIDTH = 256;
export const PREVIEW_HEIGHT = 144;

const OUTPUTS = 4;
/** Previews are for reading a patch, not for watching: a few times a second is enough */
const PREVIEW_INTERVAL = 80;
const PREVIEWS_PER_PASS = 6;

/**
 * Where an input node stands: nothing to play yet (no file chosen, no screen
 * picked), opening, playing, a file this browser doesn't have, or failed.
 */
export type SourceStatus = "idle" | "loading" | "live" | "missing" | "error";

export interface EngineOptions {
  /** The file behind a picture or video node, if this browser has it */
  loadMedia: (id: string) => Promise<Blob | undefined>;
  onstatus: (nodeId: string, status: SourceStatus | undefined) => void;
}

/** What an input node holds open, whichever of hydra's inputs it plays on */
interface Held {
  key: string;
  slot: number;
  input?: OpenInput;
}

/** What makes two sources the same thing to open */
function keyOf(source: Source): string {
  if (source.kind === "cam") return `cam:${source.device}`;
  if (source.kind === "screen") return "screen";
  return `${source.kind}:${source.media?.id ?? ""}`;
}

interface Preview {
  context: CanvasRenderingContext2D;
  image: ImageData;
  // biome-ignore lint/suspicious/noExplicitAny: a regl draw command
  draw?: (props: any) => void;
}

export class Engine {
  fps = 0;
  paused = false;

  private hydra: Hydra;
  private synth: Chain;
  private params = new Map<string, Record<string, ParamState>>();
  /** What each control node's settings add up to right now, by node */
  private controls = new Map<string, Drive>();
  private compiled: Compiled | undefined;
  private previews = new Map<string, Preview>();
  private previewQueue: string[] = [];
  private previewTarget: Chain;
  private blank: Chain;
  private held = new Map<string, Held>();
  private bound: (OpenInput | undefined)[] = [];
  private env: Env;
  private frame = 0;
  private last = 0;
  private lastPreview = 0;
  private frames = 0;
  private fpsSince = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private options: EngineOptions,
  ) {
    this.hydra = new Hydra({
      canvas,
      width: canvas.width,
      height: canvas.height,
      detectAudio: false,
      makeGlobal: false,
      autoLoop: false,
      enableStreamCapture: false,
    });
    this.synth = this.hydra.synth;

    const { regl } = this.hydra;
    this.previewTarget = regl.framebuffer({
      color: regl.texture({ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, format: "rgba" }),
      depthStencil: false,
    });
    this.blank = regl.texture({ width: 1, height: 1 });

    this.env = {
      time: 0,
      bpm: 30,
      fft: (bin) => this.synth.a?.fft?.[bin] ?? 0,
      mouse: { x: 0, y: 0 },
    };
  }

  start() {
    this.last = performance.now();
    this.fpsSince = this.last;
    const loop = (now: number) => {
      this.frame = requestAnimationFrame(loop);
      const elapsed = now - this.last;
      this.last = now;
      this.tick(this.paused ? 0 : elapsed, now);
    };
    this.frame = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.frame);
    for (const nodeId of [...this.held.keys()]) this.release(nodeId);
  }

  resize(width: number, height: number) {
    this.hydra.setResolution(width, height);
  }

  /** The values hydra reads every frame. Cheap: call it on every change. */
  setParams(nodes: PatchNode[]) {
    this.params.clear();
    this.controls.clear();
    let audio = false;
    for (const node of nodes) {
      this.params.set(node.id, node.params);
      const control = getDef(node.fn)?.control;
      if (control) this.controls.set(node.id, controlDrive(control, node));
      audio ||= control === "audio";
      for (const name in node.params) audio ||= node.params[name].drive?.mode === "audio";
    }
    if (audio) this.enableAudio();
  }

  /** New wiring: build hydra's chains again, and the previews with them */
  apply(compiled: Compiled) {
    this.compiled = compiled;
    this.applySources(compiled.sources);
    for (let buffer = 0; buffer < OUTPUTS; buffer++) {
      const output = compiled.outputs.findLast((candidate) => candidate.buffer === buffer);
      this.chainOf(output?.expr ?? { kind: "empty" }).out(this.synth[`o${buffer}`]);
    }
    for (const [nodeId, preview] of this.previews) {
      preview.draw = this.previewCommand(nodeId);
    }
  }

  /** Which output plays on the canvas */
  show(buffer: number) {
    this.synth.render(this.synth[`o${buffer}`]);
  }

  attachPreview(nodeId: string, canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) return;
    this.previews.set(nodeId, {
      context,
      image: new ImageData(PREVIEW_WIDTH, PREVIEW_HEIGHT),
      draw: this.previewCommand(nodeId),
    });
  }

  detachPreview(nodeId: string) {
    this.previews.delete(nodeId);
  }

  /** The microphone, asked for the first time a parameter listens to it */
  private enableAudio() {
    if (this.hydra.detectAudio) return;
    this.hydra.detectAudio = true;
    this.hydra._initAudio();
  }

  /** A screen is only shared when asked: call this from the click that asks */
  startScreen(nodeId: string) {
    const held = this.held.get(nodeId);
    if (held?.key === "screen" && !held.input) this.open(nodeId, held.key, openScreen());
  }

  /** Let go of what a node plays, and leave the node ready to start again */
  stopSource(nodeId: string) {
    const held = this.held.get(nodeId);
    if (!held?.input) return;
    held.input.close();
    held.input = undefined;
    this.options.onstatus(nodeId, "idle");
    this.bindInputs();
  }

  /**
   * Cameras, screens and files belong to their node, not to the hydra input
   * they happen to play on: when another node goes and the inputs shift, a
   * camera keeps running and a shared screen stays shared.
   */
  private applySources(sources: Source[]) {
    const wanted = new Map(sources.map((source) => [source.nodeId, source]));
    for (const [nodeId, held] of this.held) {
      const source = wanted.get(nodeId);
      if (!source || keyOf(source) !== held.key) this.release(nodeId);
    }
    for (const source of sources) {
      const held = this.held.get(source.nodeId);
      if (held) held.slot = source.slot;
      else this.hold(source);
    }
    this.bindInputs();
  }

  private hold(source: Source) {
    const { nodeId, media } = source;
    const key = keyOf(source);
    this.held.set(nodeId, { key, slot: source.slot });
    if (source.kind === "cam") {
      this.open(nodeId, key, openCamera(source.device));
    } else if (source.kind === "screen" || !media) {
      this.options.onstatus(nodeId, "idle");
    } else {
      const open = source.kind === "image" ? openImage : openVideo;
      const opening = this.options.loadMedia(media.id).then((file) => file && open(file));
      this.open(nodeId, key, opening);
    }
  }

  /** Follow something being opened, unless its node has moved on meanwhile */
  private open(nodeId: string, key: string, opening: Promise<OpenInput | undefined>) {
    this.options.onstatus(nodeId, "loading");
    const current = () => {
      const held = this.held.get(nodeId);
      return held?.key === key && !held.input ? held : undefined;
    };
    opening.then(
      (input) => {
        const held = current();
        if (!held || !input) {
          input?.close();
          if (held) this.options.onstatus(nodeId, "missing");
          return;
        }
        held.input = input;
        input.onended = () => this.stopSource(nodeId);
        this.options.onstatus(nodeId, "live");
        this.bindInputs();
      },
      (error) => {
        if (!current()) return;
        console.warn("could not open the input", error);
        // Closing the browser's screen picker is a choice, not a failure
        const dismissed = key === "screen" && (error as Error)?.name === "NotAllowedError";
        this.options.onstatus(nodeId, dismissed ? "idle" : "error");
      },
    );
  }

  private release(nodeId: string) {
    this.held.get(nodeId)?.input?.close();
    this.held.delete(nodeId);
    this.options.onstatus(nodeId, undefined);
  }

  /** Point each of hydra's inputs at what its node holds open, or at nothing */
  private bindInputs() {
    const inputs = [...this.held.values()];
    for (let slot = 0; slot < MAX_SOURCES; slot++) {
      const input = inputs.find((held) => held.slot === slot)?.input;
      if (input === this.bound[slot]) continue;
      this.bound[slot] = input;
      const target = this.synth[`s${slot}`];
      const previous = target.tex;
      try {
        if (input) target.init({ src: input.element, dynamic: input.dynamic });
        else {
          target.src = null;
          target.tex = this.hydra.regl.texture({ shape: [1, 1] });
        }
        previous?.destroy?.();
      } catch (error) {
        // Too large for this GPU, most likely
        console.warn("could not show the input", error);
        const owner = [...this.held].find(([, held]) => held.input === input)?.[0];
        if (owner) this.options.onstatus(owner, "error");
      }
    }
  }

  private chainOf(expr: Expr): Chain {
    return buildChain(expr, {
      synth: this.synth,
      arg: (node, name, fallback, control) => (props?: { time?: number }) => {
        if (props?.time !== undefined) this.env.time = props.time;
        // A wire wins over the parameter's own value: the control's number, read as it is now
        const wired = control && this.controls.get(control.nodeId);
        if (wired) return evalDrive(wired, this.env);
        const state = this.params.get(node.id)?.[name];
        return state ? evalParam(state, this.env) : fallback;
      },
    });
  }

  /** The number a control node gives right now, for the node to show */
  controlValue(nodeId: string): number | undefined {
    const drive = this.controls.get(nodeId);
    return drive && evalDrive(drive, this.env);
  }

  /** A draw command for one node's texture, into the shared preview target */
  private previewCommand(nodeId: string): Preview["draw"] {
    if (!this.compiled) return undefined;
    try {
      const [pass] = this.chainOf(this.compiled.exprOf(nodeId)).glsl();
      const output = this.hydra.o[0];
      return this.hydra.regl({
        frag: pass.frag,
        vert: output.vert,
        attributes: output.attributes,
        uniforms: { ...pass.uniforms, prevBuffer: this.blank },
        count: 3,
        framebuffer: this.previewTarget,
      });
    } catch (error) {
      console.warn("could not build the preview", error);
      return undefined;
    }
  }

  private tick(elapsed: number, now: number) {
    const { mouse, bpm } = this.synth;
    this.env.bpm = bpm;
    this.env.mouse.x = (mouse?.x ?? 0) / window.innerWidth;
    this.env.mouse.y = (mouse?.y ?? 0) / window.innerHeight;
    this.hydra.tick(elapsed);
    this.env.time = this.synth.time;

    if (now - this.lastPreview >= PREVIEW_INTERVAL) {
      this.lastPreview = now;
      this.drawPreviews();
    }

    this.frames++;
    if (now - this.fpsSince >= 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsSince));
      this.frames = 0;
      this.fpsSince = now;
    }
  }

  /**
   * Each preview is read back from the GPU, so only a few go per pass. The
   * rows come back in the order hydra shows them on screen (its last pass
   * turns the picture over), so they go onto the node's canvas as they are.
   */
  private drawPreviews() {
    if (this.previews.size === 0) return;
    if (this.previewQueue.length === 0) this.previewQueue = [...this.previews.keys()];
    const props = {
      time: this.synth.time,
      bpm: this.synth.bpm,
      mouse: this.synth.mouse,
      resolution: [PREVIEW_WIDTH, PREVIEW_HEIGHT],
    };
    for (const nodeId of this.previewQueue.splice(0, PREVIEWS_PER_PASS)) {
      const preview = this.previews.get(nodeId);
      if (!preview?.draw) continue;
      try {
        preview.draw(props);
        this.hydra.regl.read({
          framebuffer: this.previewTarget,
          data: new Uint8Array(preview.image.data.buffer),
        });
        preview.context.putImageData(preview.image, 0, 0);
      } catch (error) {
        // A shader that doesn't compile: leave this preview alone until the wiring changes
        preview.draw = undefined;
        console.warn("could not draw the preview", error);
      }
    }
  }
}
