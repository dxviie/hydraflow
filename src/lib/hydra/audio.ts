/**
 * What the patch listens to. hydra opens the system's default microphone and
 * offers no other, so the editor listens for itself: it opens the input the
 * person chose and reads it with the analyser hydra uses, set up the way
 * hydra sets it up (Meyda's loudness), into `Bands`, which keeps hydra's
 * arithmetic. hydra's own audio stays off.
 *
 * A choice is the browser's id for an input and its label. Ids change
 * (another browser, cleared site data), so an input is found again by its
 * label. One that isn't connected leaves the system default standing in
 * until it is back.
 */
import Meyda from "meyda";

import { Bands } from "../graph/audio";

export interface AudioDevice {
  deviceId: string;
  label: string;
}

/** What this browser remembers about the sound: nothing a patch carries */
export interface AudioPrefs {
  /** The chosen input; without one, the system default */
  input?: AudioDevice;
  /** The bands show while editing */
  visualiser: boolean;
}

/**
 * Where listening stands: not started (nothing listens yet), asking for the
 * microphone, listening, turned away by the browser, or without anything to
 * listen to.
 */
export type AudioStatus = "off" | "asking" | "live" | "blocked" | "failed";

export interface AudioState {
  status: AudioStatus;
  /** The input being listened to, when it isn't the system default */
  device?: AudioDevice;
  /** The chosen input isn't connected: the system default stands in */
  missing: boolean;
}

interface Opened {
  stream: MediaStream;
  device?: AudioDevice;
  missing: boolean;
}

const MAX_LABEL = 200;

// Not inputs of their own: the system default and (on Windows) the one for calls
const ALIASES = new Set(["default", "communications"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A choice from storage, or nothing for the system default */
function parseInput(raw: unknown): AudioDevice | undefined {
  if (!isRecord(raw)) return undefined;
  const deviceId = typeof raw.deviceId === "string" ? raw.deviceId.slice(0, MAX_LABEL) : "";
  const label = typeof raw.label === "string" ? raw.label.slice(0, MAX_LABEL) : "";
  if (ALIASES.has(deviceId) || (!deviceId && !label)) return undefined;
  return { deviceId, label };
}

export function parseAudioPrefs(raw: unknown): AudioPrefs {
  const given = isRecord(raw) ? raw : {};
  const prefs: AudioPrefs = { visualiser: given.visualiser === true };
  const input = parseInput(given.input);
  if (input) prefs.input = input;
  return prefs;
}

function sameInput(one: AudioDevice | undefined, other: AudioDevice | undefined): boolean {
  return one?.deviceId === other?.deviceId && one?.label === other?.label;
}

/**
 * The inputs to choose from. Their labels are empty until the page may use
 * the microphone. `defaultLabel` is what the browser calls the system
 * default, where it says.
 */
export async function listInputs(
  devices: Pick<MediaDevices, "enumerateDevices"> | undefined,
): Promise<{ inputs: AudioDevice[]; defaultLabel: string }> {
  const inputs: AudioDevice[] = [];
  let defaultLabel = "";
  if (!devices?.enumerateDevices) return { inputs, defaultLabel };
  for (const device of await devices.enumerateDevices()) {
    if (device.kind !== "audioinput") continue;
    if (device.deviceId === "default") defaultLabel = device.label;
    if (!device.deviceId || ALIASES.has(device.deviceId)) continue;
    inputs.push({ deviceId: device.deviceId, label: device.label });
  }
  return { inputs, defaultLabel };
}

/** The input a choice means among those connected: the same id, else the same label */
export function findInput(
  choice: AudioDevice | undefined,
  inputs: AudioDevice[],
): AudioDevice | undefined {
  if (!choice) return undefined;
  return (
    inputs.find((input) => input.deviceId === choice.deviceId) ??
    (choice.label ? inputs.find((input) => input.label === choice.label) : undefined)
  );
}

/** The list's value for the system default, and for a chosen input that isn't connected */
export const DEFAULT_INPUT = "";
export const MISSING_INPUT = "missing";

/** What the list offers: the system default, every input connected, and the chosen one when it isn't */
export function inputOptions(
  inputs: AudioDevice[],
  defaultLabel: string,
  choice: AudioDevice | undefined,
): { options: { value: string; label: string }[]; value: string } {
  const options = [{ value: DEFAULT_INPUT, label: defaultLabel || "system default" }];
  inputs.forEach((input, index) => {
    // No names until the page may use the microphone
    options.push({ value: input.deviceId, label: input.label || `input ${index + 1}` });
  });
  if (!choice) return { options, value: DEFAULT_INPUT };
  const found = findInput(choice, inputs);
  if (found) return { options, value: found.deviceId };
  options.push({
    value: MISSING_INPUT,
    label: `${choice.label || "chosen input"} (not connected)`,
  });
  return { options, value: MISSING_INPUT };
}

/** What stands between the patch and the sound, in a line; nothing while all is well */
export function audioNote(state: AudioState, choice?: AudioDevice): string {
  switch (state.status) {
    case "off":
      return "off until something listens";
    case "asking":
      return "asking for the microphone…";
    case "blocked":
      return "the microphone isn't allowed here";
    case "failed":
      return "there is nothing to listen to";
    case "live":
      return state.missing
        ? `${choice?.label || "that input"} isn't connected: listening to the system default`
        : "";
  }
}

function stopStream(stream: MediaStream | undefined) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

function isLive(stream: MediaStream | undefined): boolean {
  return stream?.getAudioTracks().some((track) => track.readyState === "live") ?? false;
}

/** Being turned away is an answer, not an input that isn't there */
const refused = (error: unknown) =>
  (error as Error)?.name === "NotAllowedError" || (error as Error)?.name === "SecurityError";

type Devices = Pick<MediaDevices, "enumerateDevices" | "getUserMedia">;

async function openExact(devices: Devices, deviceId: string): Promise<MediaStream | undefined> {
  try {
    return await devices.getUserMedia({ video: false, audio: { deviceId: { exact: deviceId } } });
  } catch (error) {
    if (refused(error)) throw error;
    return undefined;
  }
}

/** The connected input with the choice's label under another id, and whether labels show */
async function lookUp(devices: Devices, choice: AudioDevice) {
  let inputs: AudioDevice[] = [];
  try {
    ({ inputs } = await listInputs(devices));
  } catch {
    // No list: the system default it is
  }
  const match = choice.label
    ? inputs.find((input) => input.label === choice.label && input.deviceId !== choice.deviceId)
    : undefined;
  return { match, labelled: inputs.some((input) => input.label) };
}

/**
 * A stream of the chosen input, or of the system default when there is no
 * choice or it isn't connected. The sound is asked for the way hydra asks.
 */
export async function openInput(
  devices: Devices,
  choice: AudioDevice | undefined,
): Promise<Opened> {
  let labelled = true;
  if (choice) {
    const direct = choice.deviceId ? await openExact(devices, choice.deviceId) : undefined;
    if (direct) return { stream: direct, device: choice, missing: false };
    const found = await lookUp(devices, choice);
    labelled = found.labelled;
    const moved = found.match && (await openExact(devices, found.match.deviceId));
    if (moved) return { stream: moved, device: found.match, missing: false };
  }
  const fallback = await devices.getUserMedia({ video: false, audio: true });
  if (choice && !labelled) {
    // Labels only show once the page may listen, which it now does
    const { match } = await lookUp(devices, choice);
    const moved = match && (await openExact(devices, match.deviceId));
    if (moved) {
      stopStream(fallback);
      return { stream: moved, device: match, missing: false };
    }
  }
  return { stream: fallback, missing: choice !== undefined };
}

export class Listener {
  /** The bands as they are this frame, for parameters to read and the visualiser to draw */
  readonly bands = new Bands();
  state: AudioState = { status: "off", missing: false };

  private devices: MediaDevices | undefined = globalThis.navigator?.mediaDevices;
  private wanted = false;
  private closed = false;
  /** The choice the stream was opened for */
  private openedFor: AudioDevice | undefined;
  private stream: MediaStream | undefined;
  private context: AudioContext | undefined;
  private analyser: ReturnType<typeof Meyda.createMeydaAnalyzer> | undefined;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private choice: AudioDevice | undefined,
    /** Called when the state changes, and when inputs come and go */
    private onchange: (state: AudioState) => void,
  ) {
    this.devices?.addEventListener?.("devicechange", this.ondevicechange);
  }

  /** Start listening. The first time, the browser asks for the microphone. */
  start() {
    if (this.wanted) return;
    this.wanted = true;
    this.reopen();
  }

  /** Ask again, after the browser turned the microphone down or found none */
  retry() {
    this.wanted = true;
    this.reopen();
  }

  /** Listen to another input, or to the system default; before listening starts, remember it */
  choose(choice: AudioDevice | undefined) {
    this.choice = choice;
    if (this.wanted) this.reopen();
  }

  inputs() {
    return listInputs(this.devices);
  }

  /** Once a frame: the newest loudness, cut into bands */
  tick() {
    const loudness = this.analyser?.get()?.loudness;
    if (loudness) this.bands.feed(loudness.specific);
  }

  stop() {
    this.closed = true;
    this.devices?.removeEventListener?.("devicechange", this.ondevicechange);
    window.removeEventListener("pointerdown", this.wake);
    window.removeEventListener("keydown", this.wake);
    stopStream(this.stream);
    this.stream = undefined;
    this.context?.close().catch(() => {});
  }

  private set(state: AudioState) {
    this.state = state;
    this.onchange(state);
  }

  // One at a time: a second choice waits for the first to be open
  private reopen() {
    this.queue = this.queue
      .then(() => this.open())
      .catch((error) => console.warn("could not listen", error));
  }

  private async open() {
    if (this.closed) return;
    const choice = this.choice;
    const live = isLive(this.stream);
    if (live && !this.state.missing && sameInput(choice, this.openedFor)) return;
    if (!this.devices?.getUserMedia) {
      this.set({ status: "failed", missing: false });
      return;
    }
    // Moving to another input, the one that is open keeps playing until the new one does
    if (!live) this.set({ status: "asking", missing: false });

    let opened: Opened;
    try {
      opened = await openInput(this.devices, choice);
    } catch (error) {
      console.warn("could not open an audio input", error);
      if (!isLive(this.stream)) {
        this.set({ status: refused(error) ? "blocked" : "failed", missing: false });
      }
      return;
    }
    if (this.closed) {
      stopStream(opened.stream);
      return;
    }

    try {
      this.connect(opened.stream);
    } catch (error) {
      console.warn("could not read the audio input", error);
      stopStream(opened.stream);
      if (!isLive(this.stream)) this.set({ status: "failed", missing: false });
      return;
    }
    stopStream(this.stream);
    this.stream = opened.stream;
    this.openedFor = choice;
    for (const track of opened.stream.getAudioTracks()) {
      // Unplugged: listen to what is left
      track.addEventListener("ended", () => {
        if (opened.stream === this.stream && !this.closed) this.reopen();
      });
    }
    this.wake();
    const state: AudioState = { status: "live", missing: opened.missing };
    if (opened.device) state.device = opened.device;
    this.set(state);
  }

  /** The analyser is made once and keeps running: another input only changes what it reads */
  private connect(stream: MediaStream) {
    if (!this.context) {
      this.context = new AudioContext();
      this.context.addEventListener("statechange", this.wake);
      window.addEventListener("pointerdown", this.wake);
      window.addEventListener("keydown", this.wake);
    }
    const source = this.context.createMediaStreamSource(stream);
    if (this.analyser) {
      this.analyser.setSource(source);
      return;
    }
    // hydra's own analyser: Meyda's loudness, 512 samples at a time
    this.analyser = Meyda.createMeydaAnalyzer({
      audioContext: this.context,
      source,
      bufferSize: 512,
      featureExtractors: ["loudness"],
    });
  }

  /** A browser can put the sound to sleep until the page is touched: wake it when it is */
  private wake = () => {
    if (this.context?.state === "suspended") this.context.resume().catch(() => {});
  };

  private ondevicechange = () => {
    // An input came back, or one to listen to turned up at last. Being turned away stays an answer.
    const waiting = this.state.status === "failed" || this.state.missing || !isLive(this.stream);
    if (this.wanted && this.state.status !== "blocked" && waiting) this.reopen();
    // The list changed, whatever became of the stream
    this.onchange({ ...this.state });
  };
}
