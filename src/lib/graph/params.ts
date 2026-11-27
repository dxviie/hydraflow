/**
 * What a parameter is worth right now, and how it reads as hydra code.
 * The two stay in step: the code a patch exports draws what the patch draws.
 */
import type { ControlKind, Drive, DriveMode, ParamState, PatchNode, Wave } from "./types";

/** What a driven parameter can react to, each frame */
export interface Env {
  time: number;
  bpm: number;
  /** An audio band, 0 to 1 */
  fft: (bin: number) => number;
  /** The pointer, 0 to 1 across the window */
  mouse: { x: number; y: number };
}

export const WAVES: Wave[] = ["sine", "saw", "square", "tri"];
export const DRIVE_MODES: DriveMode[] = ["seq", "lfo", "audio", "mouse"];
export const AUDIO_BINS = 4;

const TAU = Math.PI * 2;

const modulo = (n: number, d: number) => ((n % d) + d) % d;

/** hydra's own array sequencing (array-utils.js), with its linear easing */
function seqValue(values: number[], fast: number, smooth: boolean, env: Env): number {
  if (values.length === 0) return 0;
  const index = env.time * fast * (env.bpm / 60);
  if (!smooth) return values[Math.floor(modulo(index, values.length))];
  const at = index - 0.5;
  const current = values[Math.floor(modulo(at, values.length))];
  const next = values[Math.floor(modulo(at + 1, values.length))];
  return modulo(at, 1) * (next - current) + current;
}

function waveValue(wave: Wave, phase: number): number {
  const t = modulo(phase, 1);
  switch (wave) {
    case "sine":
      return 0.5 + 0.5 * Math.sin(phase * TAU);
    case "saw":
      return t;
    case "square":
      return t < 0.5 ? 0 : 1;
    case "tri":
      return 1 - Math.abs(t * 2 - 1);
  }
}

export function evalDrive(drive: Drive, env: Env): number {
  switch (drive.mode) {
    case "seq":
      return seqValue(drive.values, drive.fast, drive.smooth, env);
    case "lfo":
      return drive.min + (drive.max - drive.min) * waveValue(drive.wave, env.time * drive.rate);
    case "audio":
      return drive.min + (drive.max - drive.min) * env.fft(drive.bin);
    case "mouse":
      return drive.min + (drive.max - drive.min) * env.mouse[drive.axis];
  }
}

/**
 * A control node is a drive with a place of its own: what its settings add
 * up to. Its number and its code are then the drive's.
 */
export function controlDrive(
  kind: ControlKind,
  node: PatchNode,
): Extract<Drive, { mode: ControlKind }> {
  const setting = (name: string, fallback: number) => node.params[name]?.value ?? fallback;
  const min = setting("min", 0);
  const max = setting("max", 1);
  if (kind === "audio") return { mode: "audio", bin: node.option ?? 0, min, max };
  const wave = WAVES[node.option ?? 0] ?? "sine";
  return { mode: "lfo", wave, rate: setting("rate", 0.2), min, max };
}

export function evalParam(param: ParamState, env: Env): number {
  return param.drive ? evalDrive(param.drive, env) : param.value;
}

/** A number the way a person would type it: no float noise, no trailing zeros */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Number(value.toFixed(3));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/** `min + span * x`, without the parts that do nothing */
function scaled(min: number, max: number, x: string): string {
  const span = formatNumber(max - min);
  const body = span === "1" ? x : `${span} * ${x}`;
  return min === 0 ? body : `${formatNumber(min)} + ${body}`;
}

export function driveCode(drive: Drive): string {
  switch (drive.mode) {
    case "seq": {
      const fast = drive.fast === 1 ? "" : `.fast(${formatNumber(drive.fast)})`;
      return `[${drive.values.map(formatNumber).join(", ")}]${fast}${drive.smooth ? ".smooth()" : ""}`;
    }
    case "lfo": {
      const phase = `time * ${formatNumber(drive.rate)}`;
      const span = drive.max - drive.min;
      switch (drive.wave) {
        case "sine": {
          const mid = formatNumber(drive.min + span / 2);
          const swing = `${formatNumber(span / 2)} * Math.sin(${phase} * ${formatNumber(TAU)})`;
          return `() => ${mid === "0" ? swing : `${mid} + ${swing}`}`;
        }
        case "saw":
          return `() => ${scaled(drive.min, drive.max, `((${phase}) % 1)`)}`;
        case "square":
          return `() => ((${phase}) % 1 < 0.5 ? ${formatNumber(drive.min)} : ${formatNumber(drive.max)})`;
        case "tri":
          return `() => ${scaled(drive.min, drive.max, `(1 - Math.abs(((${phase}) % 1) * 2 - 1))`)}`;
      }
      break;
    }
    case "audio":
      return `() => ${scaled(drive.min, drive.max, `a.fft[${drive.bin}]`)}`;
    case "mouse": {
      const position = drive.axis === "x" ? "mouse.x / innerWidth" : "mouse.y / innerHeight";
      return `() => ${scaled(drive.min, drive.max, `(${position})`)}`;
    }
  }
  return "0";
}

export function paramCode(param: ParamState): string {
  return param.drive ? driveCode(param.drive) : formatNumber(param.value);
}

/** The few words a driven row shows in place of its number */
export function driveLabel(drive: Drive): string {
  switch (drive.mode) {
    case "seq":
      return `seq ${drive.values.length}`;
    case "lfo":
      return `${drive.wave} ${formatNumber(drive.min)}…${formatNumber(drive.max)}`;
    case "audio":
      return `audio ${drive.bin}`;
    case "mouse":
      return `mouse ${drive.axis}`;
  }
}

/** A drive to start from when one is switched on, around the row's value and range */
export function defaultDrive(mode: DriveMode, value: number, min: number, max: number): Drive {
  const low = Math.min(min, value);
  const high = Math.max(max, value);
  switch (mode) {
    case "seq":
      return { mode, values: [value, (low + high) / 2, high].map(tidy), fast: 1, smooth: false };
    case "lfo":
      return { mode, wave: "sine", rate: 0.2, min: low, max: high };
    case "audio":
      return { mode, bin: 0, min: low, max: high };
    case "mouse":
      return { mode, axis: "x", min: low, max: high };
  }
}

function tidy(value: number): number {
  return Number(value.toFixed(3));
}
