/**
 * How the sound becomes `a.fft`: hydra's own settings under hydra's own
 * names, and hydra's own arithmetic. The settings belong to the patch, so
 * the sketch a patch exports reacts to sound the way the patch does.
 */
import type { ParamDef } from "../hydra/catalog";
import { formatNumber } from "./params";

export interface AudioSettings {
  /** How many bands the sound is cut into, low to high: `a.setBins` */
  bins: number;
  /** How loud a band has to be before it counts: `a.setCutoff` */
  cutoff: number;
  /** How slowly a band follows the sound, 0 to 1: `a.setSmooth` */
  smooth: number;
  /** How much louder than the cutoff reads as 1: `a.setScale` */
  scale: number;
}

export type AudioSetting = keyof AudioSettings;

/** hydra's own: a patch that leaves them alone needs no line of code for them */
export const AUDIO_DEFAULTS: AudioSettings = { bins: 4, cutoff: 2, smooth: 0.4, scale: 10 };

/** The most bands a patch asks for: what a node can still offer as buttons */
export const MAX_AUDIO_BINS = 8;

export interface AudioSettingDef extends ParamDef {
  name: AudioSetting;
  /** hydra's function that sets it */
  setter: string;
  /** What a typed or saved value is held to */
  limits: [min: number, max: number];
  doc: string;
}

/** The settings as rows: `min` and `max` are where a row scrubs */
export const AUDIO_SETTINGS: AudioSettingDef[] = [
  {
    name: "bins",
    setter: "setBins",
    default: AUDIO_DEFAULTS.bins,
    min: 1,
    max: MAX_AUDIO_BINS,
    step: 1,
    limits: [1, MAX_AUDIO_BINS],
    doc: "how many bands the sound is cut into, low to high",
  },
  {
    name: "cutoff",
    setter: "setCutoff",
    default: AUDIO_DEFAULTS.cutoff,
    min: 0,
    max: 20,
    step: 0.1,
    limits: [-100, 100],
    doc: "how loud a band has to be before it counts",
  },
  {
    name: "smooth",
    setter: "setSmooth",
    default: AUDIO_DEFAULTS.smooth,
    min: 0,
    max: 1,
    step: 0.01,
    // Past 1 a band runs away instead of following
    limits: [0, 1],
    doc: "how slowly a band follows the sound: 0 jumps, 1 stands still",
  },
  {
    name: "scale",
    setter: "setScale",
    default: AUDIO_DEFAULTS.scale,
    min: 0.1,
    max: 30,
    step: 0.1,
    // It divides: never zero
    limits: [0.01, 1000],
    doc: "how much louder than the cutoff reads as 1",
  },
];

/**
 * Settings a patch can hold, from whatever was typed or saved: each one a
 * number within its limits, hydra's own where there is none.
 */
export function tidyAudio(raw: Partial<Record<AudioSetting, unknown>>): AudioSettings {
  const settings = { ...AUDIO_DEFAULTS };
  for (const { name, limits } of AUDIO_SETTINGS) {
    const value = raw[name];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const held = Math.min(limits[1], Math.max(limits[0], value));
    settings[name] = name === "bins" ? Math.round(held) : held;
  }
  return settings;
}

export function sameAudio(one: AudioSettings, other: AudioSettings): boolean {
  return AUDIO_SETTINGS.every(({ name }) => one[name] === other[name]);
}

/** The settings as the lines of a sketch: the ones that aren't hydra's own */
export function audioCode(settings: AudioSettings): string[] {
  return AUDIO_SETTINGS.filter(({ name }) => settings[name] !== AUDIO_DEFAULTS[name]).map(
    ({ name, setter }) => `a.${setter}(${formatNumber(settings[name])})`,
  );
}

/**
 * The bands of the sound, the way hydra's `a` keeps them (its lib/audio.js;
 * a test keeps the two equal), without making arrays every frame.
 */
export class Bands {
  /** How loud each band is, smoothed: what the cutoff and the scale are measured against */
  readonly levels = new Float64Array(MAX_AUDIO_BINS);
  /** `a.fft`: each band from its cutoff up, 1 where it is `scale` louder */
  readonly fft = new Float64Array(MAX_AUDIO_BINS);

  private current = AUDIO_DEFAULTS;

  get settings(): AudioSettings {
    return this.current;
  }

  /** As in hydra, another number of bands starts them from silence */
  set settings(next: AudioSettings) {
    if (next.bins !== this.current.bins) {
      this.levels.fill(0);
      this.fft.fill(0);
    }
    this.current = next;
  }

  /** Take in the loudness of each critical band of the ear (Meyda's `loudness.specific`) */
  feed(specific: ArrayLike<number>) {
    const { bins, cutoff, smooth, scale } = this.current;
    const spacing = Math.floor(specific.length / bins);
    for (let bin = 0; bin < bins; bin++) {
      let loudness = 0;
      const end = (bin + 1) * spacing;
      for (let at = bin * spacing; at < end; at++) loudness += specific[at];
      const level = loudness * (1 - smooth) + this.levels[bin] * smooth;
      this.levels[bin] = level;
      this.fft[bin] = Math.max(0, (level - cutoff) / scale);
    }
  }
}
