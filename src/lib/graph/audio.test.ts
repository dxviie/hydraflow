import { afterAll, beforeAll, describe, expect, test } from "bun:test";

// hydra's own reading of the sound, to keep ours equal to it
// @ts-expect-error hydra-synth ships no types
import HydraAudio from "../../../node_modules/hydra-synth/src/lib/audio.js";
import {
  AUDIO_DEFAULTS,
  AUDIO_SETTINGS,
  type AudioSettings,
  audioCode,
  Bands,
  MAX_AUDIO_BINS,
  sameAudio,
  tidyAudio,
} from "./audio";

interface HydraA {
  fft: number[];
  bins: number[];
  meyda: unknown;
  tick: () => void;
}

/** The loudness of the ear's 24 critical bands, as Meyda hands it over: different every frame */
function loudness(frame: number): Float32Array {
  return Float32Array.from(
    { length: 24 },
    (_, band) => 1.5 + Math.sin(frame * 0.7 + band) + 0.4 * Math.cos(frame * 0.13 * band),
  );
}

/** hydra's `a`, with nothing to listen to and nowhere to draw */
function hydraAudio(): HydraA {
  const audio = new HydraAudio({ parentEl: { appendChild() {} } });
  return audio;
}

/** Let hydra's `a` hear a frame, the way its analyser would report it */
function hear(audio: HydraA, specific: Float32Array) {
  const total = specific.reduce((sum, band) => sum + band, 0);
  audio.meyda = { get: () => ({ loudness: { specific, total } }) };
  audio.tick();
}

const globals = globalThis as Record<string, unknown>;
const before = { window: globals.window, document: globals.document };

// hydra's `a` wants a page to live on: a canvas to draw its bars, a window to hang a0… on
beforeAll(() => {
  const canvas = { style: {}, getContext: () => ({}) };
  globals.window = globals;
  globals.document = { createElement: () => canvas };
});

afterAll(() => {
  globals.window = before.window;
  globals.document = before.document;
});

describe("Bands", () => {
  const cases: AudioSettings[] = [
    AUDIO_DEFAULTS,
    { bins: 6, cutoff: 1, smooth: 0.8, scale: 4 },
    { bins: 1, cutoff: 20, smooth: 0, scale: 30 },
    { bins: 5, cutoff: 0, smooth: 0.99, scale: 0.5 },
    { bins: 7, cutoff: -3, smooth: 0.2, scale: 12 },
    { bins: 8, cutoff: 4.5, smooth: 1, scale: 0.01 },
  ];

  test.each(cases)("hears what hydra hears once its exported code has run: %o", (settings) => {
    const theirs = hydraAudio();
    // Run the lines a sketch would start with, the way a hydra editor would
    new Function("a", audioCode(settings).join("\n"))(theirs);
    const ours = new Bands();
    ours.settings = settings;

    for (let frame = 0; frame < 40; frame++) {
      const specific = loudness(frame);
      hear(theirs, specific);
      ours.feed(specific);
      expect(theirs.fft).toHaveLength(settings.bins);
      for (let bin = 0; bin < settings.bins; bin++) {
        expect(ours.fft[bin]).toBeCloseTo(theirs.fft[bin], 9);
        expect(ours.levels[bin]).toBeCloseTo(theirs.bins[bin], 9);
      }
    }
  });

  test("starts the bands from silence when their number changes, as hydra does", () => {
    const bands = new Bands();
    bands.feed(loudness(3));
    expect(bands.fft[3]).toBeGreaterThan(0);
    bands.settings = { ...AUDIO_DEFAULTS, bins: 2 };
    expect([...bands.fft]).toEqual(Array(MAX_AUDIO_BINS).fill(0));
    bands.feed(loudness(4));
    // A band the sound isn't cut into stays silent
    expect(bands.fft[1]).toBeGreaterThan(0);
    expect(bands.fft[2]).toBe(0);
  });

  test("keeps what it heard when a setting other than the bands changes", () => {
    const bands = new Bands();
    bands.feed(loudness(3));
    const level = bands.levels[0];
    bands.settings = { ...AUDIO_DEFAULTS, cutoff: 5 };
    expect(bands.levels[0]).toBe(level);
  });
});

describe("audio settings", () => {
  test("are hydra's own to begin with, set by functions hydra has", () => {
    const theirs = hydraAudio() as unknown as Record<string, unknown>;
    expect(theirs.fft).toHaveLength(AUDIO_DEFAULTS.bins);
    for (const { name, setter, default: fallback } of AUDIO_SETTINGS) {
      expect(typeof theirs[setter]).toBe("function");
      expect(fallback).toBe(AUDIO_DEFAULTS[name]);
      if (name !== "bins") expect(theirs[name]).toBe(fallback);
    }
  });

  test("are written into a sketch only where they differ from hydra's", () => {
    expect(audioCode(AUDIO_DEFAULTS)).toEqual([]);
    expect(audioCode({ ...AUDIO_DEFAULTS, smooth: 0.8 })).toEqual(["a.setSmooth(0.8)"]);
    expect(audioCode({ bins: 6, cutoff: 0.1 + 0.2, smooth: 0, scale: 8 })).toEqual([
      "a.setBins(6)",
      "a.setCutoff(0.3)",
      "a.setSmooth(0)",
      "a.setScale(8)",
    ]);
  });

  test("hold whatever is typed or saved to what the sound can be read with", () => {
    expect(tidyAudio({})).toEqual(AUDIO_DEFAULTS);
    expect(tidyAudio({ bins: 40, cutoff: -1, smooth: 7, scale: 0 })).toEqual({
      bins: MAX_AUDIO_BINS,
      cutoff: -1,
      smooth: 1,
      scale: 0.01,
    });
    expect(tidyAudio({ bins: 2.6, cutoff: Number.NaN, smooth: "0.5", scale: null })).toEqual({
      ...AUDIO_DEFAULTS,
      bins: 3,
    });
    expect(tidyAudio({ bins: 0 }).bins).toBe(1);
  });

  test("are the same when every one of them is", () => {
    expect(sameAudio(AUDIO_DEFAULTS, { ...AUDIO_DEFAULTS })).toBe(true);
    expect(sameAudio(AUDIO_DEFAULTS, { ...AUDIO_DEFAULTS, scale: 9 })).toBe(false);
  });
});
