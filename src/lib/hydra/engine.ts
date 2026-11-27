/**
 * The hydra instance behind the editor. A compiled patch goes in; hydra draws
 * it on the canvas, and draws the texture of any node that asked for a
 * preview into that node's own small canvas.
 *
 * Parameters reach hydra as functions it calls every frame, so scrubbing a
 * value never recompiles a shader: only a change of wiring does.
 */
import Hydra from "hydra-synth";

import { buildChain, type Chain, type Compiled, type Expr } from "../graph/compile";
import { type Env, evalParam } from "../graph/params";
import type { ParamState, PatchNode } from "../graph/types";
import { MAX_SOURCES } from "./catalog";

export const PREVIEW_WIDTH = 256;
export const PREVIEW_HEIGHT = 144;

const OUTPUTS = 4;
/** Previews are for reading a patch, not for watching: a few times a second is enough */
const PREVIEW_INTERVAL = 80;
const PREVIEWS_PER_PASS = 6;

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
  private compiled: Compiled | undefined;
  private previews = new Map<string, Preview>();
  private previewQueue: string[] = [];
  private previewTarget: Chain;
  private blank: Chain;
  private cameraDevices: (number | undefined)[] = [];
  private env: Env;
  private frame = 0;
  private last = 0;
  private lastPreview = 0;
  private frames = 0;
  private fpsSince = 0;

  constructor(canvas: HTMLCanvasElement) {
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
  }

  resize(width: number, height: number) {
    this.hydra.setResolution(width, height);
  }

  /** The values hydra reads every frame. Cheap: call it on every change. */
  setParams(nodes: PatchNode[]) {
    this.params.clear();
    let audio = false;
    for (const node of nodes) {
      this.params.set(node.id, node.params);
      for (const name in node.params) audio ||= node.params[name].drive?.mode === "audio";
    }
    if (audio) this.enableAudio();
  }

  /** New wiring: build hydra's chains again, and the previews with them */
  apply(compiled: Compiled) {
    this.compiled = compiled;
    this.applyCameras(compiled);
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

  private applyCameras(compiled: Compiled) {
    for (let source = 0; source < MAX_SOURCES; source++) {
      const device = compiled.cameras.find((camera) => camera.source === source)?.device;
      if (device === this.cameraDevices[source]) continue;
      this.cameraDevices[source] = device;
      const input = this.synth[`s${source}`];
      if (device === undefined) input.clear();
      else input.initCam(device);
    }
  }

  private chainOf(expr: Expr): Chain {
    return buildChain(expr, {
      synth: this.synth,
      arg: (node, name, fallback) => (props?: { time?: number }) => {
        if (props?.time !== undefined) this.env.time = props.time;
        const state = this.params.get(node.id)?.[name];
        return state ? evalParam(state, this.env) : fallback;
      },
    });
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

  /** Each preview is read back from the GPU, so only a few go per pass */
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
