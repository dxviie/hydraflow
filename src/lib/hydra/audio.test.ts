import { describe, expect, test } from "bun:test";

import {
  type AudioDevice,
  audioNote,
  findInput,
  inputOptions,
  listInputs,
  MISSING_INPUT,
  openInput,
  parseAudioPrefs,
} from "./audio";

const desk: AudioDevice = { deviceId: "d1", label: "Desk Mic" };
const line: AudioDevice = { deviceId: "l1", label: "Line In" };

/** A browser's media devices: what is plugged in, whether names show, and what it was asked */
function browser(inputs: AudioDevice[], { named = true, allowed = true } = {}) {
  const asked: string[] = [];
  let listening = false;
  const devices = {
    asked,
    enumerateDevices: async () =>
      [
        {
          kind: "audioinput",
          deviceId: "default",
          label: named || listening ? "Default - Desk" : "",
        },
        ...inputs.map((input) => ({
          kind: "audioinput",
          deviceId: input.deviceId,
          label: named || listening ? input.label : "",
        })),
        { kind: "videoinput", deviceId: "c1", label: "Camera" },
      ] as MediaDeviceInfo[],
    getUserMedia: async (constraints?: MediaStreamConstraints) => {
      const audio = constraints?.audio;
      const exact = typeof audio === "object" ? (audio.deviceId as { exact: string }).exact : "";
      asked.push(exact || "default");
      if (!allowed) throw Object.assign(new Error("no"), { name: "NotAllowedError" });
      if (exact && !inputs.some((input) => input.deviceId === exact)) {
        throw Object.assign(new Error("not there"), { name: "OverconstrainedError" });
      }
      listening = true;
      return { id: exact || "default", getTracks: () => [] } as unknown as MediaStream;
    },
  };
  return devices;
}

describe("the inputs to choose from", () => {
  test("are the audio inputs plugged in, without the browser's names for the default", async () => {
    expect(await listInputs(browser([desk, line]))).toEqual({
      inputs: [desk, line],
      defaultLabel: "Default - Desk",
    });
    expect(await listInputs(undefined)).toEqual({ inputs: [], defaultLabel: "" });
  });

  test("start with the system default, under the name the browser gives it", () => {
    expect(inputOptions([desk, line], "Default - Desk", undefined)).toEqual({
      options: [
        { value: "", label: "Default - Desk" },
        { value: "d1", label: "Desk Mic" },
        { value: "l1", label: "Line In" },
      ],
      value: "",
    });
    expect(inputOptions([], "", undefined).options).toEqual([
      { value: "", label: "system default" },
    ]);
  });

  test("are numbered until the page may listen and they get their names", () => {
    const unnamed = [
      { deviceId: "d1", label: "" },
      { deviceId: "l1", label: "" },
    ];
    expect(inputOptions(unnamed, "", unnamed[1])).toMatchObject({
      options: [{ label: "system default" }, { label: "input 1" }, { label: "input 2" }],
      value: "l1",
    });
  });

  test("show the chosen one as it is found again: by its id, else by its name", () => {
    expect(inputOptions([desk, line], "", line).value).toBe("l1");
    const moved = { deviceId: "another-browser", label: "Line In" };
    expect(findInput(moved, [desk, line])).toBe(line);
    expect(inputOptions([desk, line], "", moved).value).toBe("l1");
  });

  test("keep a chosen input that isn't connected on the list, as not connected", () => {
    const { options, value } = inputOptions([desk], "", line);
    expect(value).toBe(MISSING_INPUT);
    expect(options.at(-1)).toEqual({ value: MISSING_INPUT, label: "Line In (not connected)" });
  });
});

describe("openInput", () => {
  test("listens to the system default when nothing is chosen, asking the way hydra asks", async () => {
    const devices = browser([desk, line]);
    const opened = await openInput(devices, undefined);
    expect(opened).toMatchObject({ missing: false });
    expect(opened.device).toBeUndefined();
    expect(devices.asked).toEqual(["default"]);
  });

  test("listens to the chosen input", async () => {
    const devices = browser([desk, line]);
    expect(await openInput(devices, line)).toMatchObject({ device: line, missing: false });
    expect(devices.asked).toEqual(["l1"]);
  });

  test("finds an input again by its name when the browser gave it another id", async () => {
    const devices = browser([desk, line]);
    const opened = await openInput(devices, { deviceId: "old", label: "Line In" });
    expect(opened).toMatchObject({ device: line, missing: false });
    expect(devices.asked).toEqual(["old", "l1"]);
  });

  test("finds it by name also where names only show once the page listens", async () => {
    const devices = browser([desk, line], { named: false });
    const opened = await openInput(devices, { deviceId: "old", label: "Line In" });
    expect(opened).toMatchObject({ device: line, missing: false });
    expect(devices.asked).toEqual(["old", "default", "l1"]);
  });

  test("lets the system default stand in for an input that isn't connected", async () => {
    const devices = browser([desk]);
    const opened = await openInput(devices, line);
    expect(opened.missing).toBe(true);
    expect(opened.device).toBeUndefined();
    expect(devices.asked).toEqual(["l1", "default"]);
  });

  test("takes no for an answer: turned away, it doesn't ask a second time", async () => {
    const devices = browser([desk, line], { allowed: false });
    await expect(openInput(devices, line)).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(devices.asked).toEqual(["l1"]);
  });
});

describe("what a browser remembers about the sound", () => {
  test("is the input and the visualiser, and nothing that isn't one", () => {
    expect(parseAudioPrefs({ input: desk, visualiser: true })).toEqual({
      input: desk,
      visualiser: true,
    });
    expect(parseAudioPrefs(null)).toEqual({ visualiser: false });
    expect(parseAudioPrefs({ input: "Desk Mic", visualiser: "yes" })).toEqual({
      visualiser: false,
    });
    expect(parseAudioPrefs({ input: { deviceId: 3, label: "Line In", more: 1 } })).toEqual({
      input: { deviceId: "", label: "Line In" },
      visualiser: false,
    });
  });

  test("has no input when the choice is the system default by another name", () => {
    expect(parseAudioPrefs({ input: { deviceId: "default", label: "Default - Desk" } })).toEqual({
      visualiser: false,
    });
    expect(parseAudioPrefs({ input: { deviceId: "", label: "" } }).input).toBeUndefined();
  });
});

describe("audioNote", () => {
  test("says what stands between the patch and the sound, and nothing while all is well", () => {
    expect(audioNote({ status: "live", missing: false })).toBe("");
    expect(audioNote({ status: "off", missing: false })).toBe("off until something listens");
    expect(audioNote({ status: "blocked", missing: false })).toContain("isn't allowed");
    expect(audioNote({ status: "live", missing: true }, line)).toBe(
      "Line In isn't connected: listening to the system default",
    );
  });
});
