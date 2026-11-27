import { describe, expect, test } from "bun:test";

// hydra's own sequencing, to keep ours equal to it
// @ts-expect-error hydra-synth ships no types
import arrayUtils from "../../../node_modules/hydra-synth/src/lib/array-utils.js";
import { defaultDrive, driveCode, type Env, evalDrive, evalParam, formatNumber } from "./params";
import type { Drive } from "./types";

const env = (time: number, overrides: Partial<Env> = {}): Env => ({
  time,
  bpm: 30,
  fft: () => 0,
  mouse: { x: 0, y: 0 },
  ...overrides,
});

const TIMES = [0, 0.3, 1, 1.75, 2.5, 7.2, 31.4];

/** Run exported code the way a hydra editor would */
function run(code: string, time: number, fft: number[], mouse: { x: number; y: number }): number {
  arrayUtils.init();
  const value = new Function("time", "a", "mouse", "innerWidth", "innerHeight", `return (${code})`)(
    time,
    { fft },
    { x: mouse.x * 800, y: mouse.y * 600 },
    800,
    600,
  );
  if (Array.isArray(value)) return arrayUtils.getValue(value)({ time, bpm: 30 });
  return typeof value === "function" ? value() : value;
}

describe("evalDrive", () => {
  const drives: Drive[] = [
    { mode: "seq", values: [20, 40, 80], fast: 1, smooth: false },
    { mode: "seq", values: [20, 40, 80], fast: 0.5, smooth: true },
    { mode: "seq", values: [1], fast: 3, smooth: true },
    { mode: "lfo", wave: "sine", rate: 0.2, min: 4, max: 8 },
    { mode: "lfo", wave: "sine", rate: 1, min: -1, max: 1 },
    { mode: "lfo", wave: "saw", rate: 0.7, min: 0, max: 1 },
    { mode: "lfo", wave: "square", rate: 0.7, min: 2, max: 5 },
    { mode: "lfo", wave: "tri", rate: 0.7, min: 0, max: 10 },
    { mode: "audio", bin: 2, min: 0.1, max: 0.9 },
    { mode: "audio", bin: 0, min: 0, max: 1 },
    { mode: "mouse", axis: "x", min: 0, max: 1 },
    { mode: "mouse", axis: "y", min: -2, max: 2 },
  ];

  test.each(drives)("draws what its exported code draws: %o", (drive) => {
    const fft = [0.1, 0.2, 0.7, 0.4];
    const mouse = { x: 0.25, y: 0.8 };
    for (const time of TIMES) {
      const ours = evalDrive(drive, env(time, { fft: (bin) => fft[bin], mouse }));
      expect(ours).toBeCloseTo(run(driveCode(drive), time, fft, mouse), 2);
    }
  });

  test("a plain value is just the value, and comes back when a drive is removed", () => {
    expect(evalParam({ value: 0.25 }, env(3))).toBe(0.25);
    const driven = { value: 0.25, drive: defaultDrive("lfo", 0.25, 0, 1) };
    expect(evalParam(driven, env(0))).toBeCloseTo(0.5);
    expect(evalParam({ value: driven.value }, env(0))).toBe(0.25);
  });
});

describe("driveCode", () => {
  test("leaves out what does nothing", () => {
    expect(driveCode({ mode: "seq", values: [1, 2], fast: 1, smooth: false })).toBe("[1, 2]");
    expect(driveCode({ mode: "audio", bin: 1, min: 0, max: 1 })).toBe("() => a.fft[1]");
    expect(driveCode({ mode: "lfo", wave: "sine", rate: 0.2, min: 4, max: 8 })).toBe(
      "() => 6 + 2 * Math.sin(time * 0.2 * 6.283)",
    );
  });
});

describe("defaultDrive", () => {
  test("starts from the row's value and stays in its range", () => {
    expect(defaultDrive("seq", 40, 0, 200)).toEqual({
      mode: "seq",
      values: [40, 100, 200],
      fast: 1,
      smooth: false,
    });
    expect(defaultDrive("lfo", 10, -6.28, 6.28)).toMatchObject({ min: -6.28, max: 10 });
  });
});

describe("formatNumber", () => {
  test("writes numbers the way people type them", () => {
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
    expect(formatNumber(40)).toBe("40");
    expect(formatNumber(-0.0001)).toBe("0");
    expect(formatNumber(Number.NaN)).toBe("0");
  });
});
