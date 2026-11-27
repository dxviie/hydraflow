<script lang="ts">
  import { AUDIO_DEFAULTS, type Bands, MAX_AUDIO_BINS } from "../graph/audio";

  interface Props {
    /** The bands as they are right now, or nothing while there is no engine */
    read: () => Bands | undefined;
  }

  let { read }: Props = $props();

  /**
   * How loud the picture is tall enough for, for each critical band of the
   * ear that goes into a band: with four bands that is hydra's own picture.
   * It grows when the settings reach past it.
   */
  const RANGE = 5;
  const CRITICAL_BANDS = 24;
  const HEIGHT = 56;
  /** Under the bars, the number each band goes by */
  const NAMES_HEIGHT = 14;
  const NAMES = Array.from({ length: MAX_AUDIO_BINS }, (_, band) => String(band));

  /** Where a loudness sits, in px from the top */
  const place = (level: number, top: number) =>
    HEIGHT * (1 - Math.min(1, Math.max(0, level / top)));

  let canvas = $state<HTMLCanvasElement>();

  $effect(() => {
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const style = getComputedStyle(canvas);
    const width = canvas.clientWidth;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = (HEIGHT + NAMES_HEIGHT) * ratio;
    context.scale(ratio, ratio);
    context.font = `10px ${style.fontFamily}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    const text = style.getPropertyValue("--text");
    const counted = style.getPropertyValue("--num");
    const dim = style.getPropertyValue("--dim");

    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const bands = read();
      const { bins, cutoff, scale } = bands?.settings ?? AUDIO_DEFAULTS;
      const range = RANGE * Math.floor(CRITICAL_BANDS / bins);
      const top = Math.max(range, (cutoff + scale) * 1.1);
      const floor = place(cutoff, top);
      const full = place(cutoff + scale, top);
      const band = width / bins;

      context.clearRect(0, 0, width, HEIGHT + NAMES_HEIGHT);
      for (let bin = 0; bin < bins; bin++) {
        const at = place(bands?.levels[bin] ?? 0, top);
        const left = bin * band + 1;
        // All of the band faintly; in full, the part between the lines: that is the number
        context.globalAlpha = 0.25;
        context.fillStyle = text;
        context.fillRect(left, at, band - 2, HEIGHT - at);
        context.globalAlpha = 1;
        if (at < floor) {
          const from = Math.max(at, full);
          context.fillStyle = counted;
          context.fillRect(left, from, band - 2, floor - from);
        }
        context.fillStyle = dim;
        context.fillText(NAMES[bin], left + band / 2 - 1, HEIGHT + NAMES_HEIGHT / 2);
      }
      // The cutoff, where a band starts to count, and above it where it reads 1
      context.globalAlpha = 0.6;
      context.fillStyle = text;
      context.fillRect(0, Math.min(HEIGHT - 1, Math.round(floor)), width, 1);
      context.fillRect(0, Math.round(full), width, 1);
      context.globalAlpha = 1;
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  });
</script>

<canvas bind:this={canvas} aria-hidden="true"></canvas>

<style>
  canvas {
    display: block;
    width: 100%;
    height: 70px;
  }
</style>
