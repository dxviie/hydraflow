<script lang="ts">
  import { formatNumber } from "../graph/params";

  interface Props {
    /** The number right now, or nothing while there is none to show */
    read: () => number | undefined;
    /** What the number moves between */
    min: number;
    max: number;
  }

  let { read, min, max }: Props = $props();

  const WIDTH = 214;
  const HEIGHT = 40;
  /** Px between two samples: the trace holds a few seconds */
  const STEP = 2;
  const MARGIN = 5;

  let canvas = $state<HTMLCanvasElement>();
  let now = $state<HTMLElement>();

  $effect(() => {
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = WIDTH * ratio;
    canvas.height = HEIGHT * ratio;
    context.scale(ratio, ratio);
    context.lineWidth = 1.5;
    context.lineJoin = "round";
    context.strokeStyle = getComputedStyle(canvas).color;

    const samples = new Float32Array(Math.floor(WIDTH / STEP) + 1);
    let filled = 0;
    let ticks = 0;
    let frame = 0;

    const draw = () => {
      frame = requestAnimationFrame(draw);
      // Every other frame is plenty to read a wave by
      if (ticks++ % 2 === 1) return;
      const value = read();
      if (value === undefined) return;
      samples.copyWithin(0, 1);
      samples[samples.length - 1] = value;
      filled = Math.min(filled + 1, samples.length);

      const low = Math.min(min, max);
      const span = Math.abs(max - min) || 1;
      context.clearRect(0, 0, WIDTH, HEIGHT);
      context.beginPath();
      for (let index = samples.length - filled; index < samples.length; index++) {
        const level = Math.min(1, Math.max(0, (samples[index] - low) / span));
        const x = WIDTH - (samples.length - 1 - index) * STEP;
        const y = HEIGHT - MARGIN - level * (HEIGHT - 2 * MARGIN);
        if (index === samples.length - filled) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
      if (now && ticks % 6 === 1) now.textContent = formatNumber(value);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  });
</script>

<div class="scope">
  <canvas bind:this={canvas} aria-hidden="true"></canvas>
  <span class="now" bind:this={now} aria-hidden="true"></span>
</div>

<style>
  .scope {
    position: relative;
    height: 40px;
    border-top: 1px solid var(--rule);
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    color: var(--num);
  }

  .now {
    position: absolute;
    top: 3px;
    left: 6px;
    padding: 1px 4px;
    background: #000;
    color: var(--soft);
    font-size: 11px;
  }

  .now:empty {
    display: none;
  }
</style>
