<script lang="ts">
  import { getContext } from "svelte";

  import { AUDIO_SETTINGS, type AudioSettings, tidyAudio } from "../graph/audio";
  import {
    type AudioDevice,
    type AudioState,
    audioNote,
    inputOptions,
    MISSING_INPUT,
  } from "../hydra/audio";
  import { CATEGORIES } from "../hydra/catalog";
  import { EDITOR, type EditorContext } from "./context";
  import ParamRow from "./ParamRow.svelte";
  import Spectrum from "./Spectrum.svelte";

  interface Props {
    /** The settings show; otherwise only the visualiser does */
    open: boolean;
    /** How the patch reads the sound */
    settings: AudioSettings;
    /** Where listening stands */
    hearing: AudioState;
    /** The input this browser listens to; without one, the system default */
    input: AudioDevice | undefined;
    visualiser: boolean;
    onsettings: (settings: AudioSettings) => void;
    oninput: (input: AudioDevice | undefined) => void;
    onvisualiser: (shown: boolean) => void;
    onopen: () => void;
  }

  let {
    open,
    settings,
    hearing,
    input,
    visualiser,
    onsettings,
    oninput,
    onvisualiser,
    onopen,
  }: Props = $props();

  const ABOUT = "how the sound becomes a.fft · these four go with the patch";
  const STATUS = {
    off: "off",
    asking: "asking",
    live: "listening",
    blocked: "no sound",
    failed: "no sound",
  };

  const editor = getContext<EditorContext>(EDITOR);

  let inputs = $state.raw<AudioDevice[]>([]);
  let defaultLabel = $state("");
  let hint = $state(ABOUT);

  // Read again whenever listening changes: inputs only have names once the page may listen
  $effect(() => {
    void hearing;
    const engine = editor.engine;
    if (!open || !engine) return;
    let current = true;
    engine.audioInputs().then(
      (found) => {
        if (current) ({ inputs, defaultLabel } = found);
      },
      (error) => console.warn("could not list the audio inputs", error),
    );
    return () => {
      current = false;
    };
  });

  const list = $derived(inputOptions(inputs, defaultLabel, input));
  const note = $derived(audioNote(hearing, input));
  const read = () => editor.engine?.bands;

  function pick(event: Event) {
    const { value } = event.currentTarget as HTMLSelectElement;
    if (value === MISSING_INPUT) return;
    oninput(inputs.find((candidate) => candidate.deviceId === value));
  }

  const about = (text: string) => () => (hint = text);
</script>

{#if open}
  <!-- nokey: a Backspace in here is not for the nodes selected behind it -->
  <section
    class="audio nokey"
    aria-label="Audio"
    style:--category={CATEGORIES.control.color}
    onpointerleave={about(ABOUT)}
  >
    <div class="head">
      <span class="name">audio</span>
      <span class="tag" class:live={hearing.status === "live"}>{STATUS[hearing.status]}</span>
    </div>

    <label
      class="line"
      onpointerenter={about("what this browser listens to · kept here, not in the patch")}
    >
      <span class="label">input</span>
      <select aria-label="Audio input" onchange={pick}>
        {#each list.options as option (option.value)}
          <option
            value={option.value}
            selected={option.value === list.value}
            disabled={option.value === MISSING_INPUT}>{option.label}</option
          >
        {/each}
      </select>
    </label>

    {#if note}
      <div class="note" role="status">
        <span>// {note}</span>
        {#if hearing.status === "off"}
          <button onclick={() => editor.engine?.listen()}>listen</button>
        {:else if hearing.status === "blocked" || hearing.status === "failed"}
          <button onclick={() => editor.engine?.retryAudio()}>try again</button>
        {/if}
      </div>
    {/if}

    {#each AUDIO_SETTINGS as def (def.name)}
      <div role="presentation" onpointerenter={about(def.doc)} onfocusin={about(def.doc)}>
        <ParamRow
          {def}
          param={{ value: settings[def.name] }}
          active={false}
          plain
          onchange={(next) => onsettings(tidyAudio({ ...settings, [def.name]: next.value }))}
        />
      </div>
    {/each}

    <div
      class="line"
      role="presentation"
      onpointerenter={about("the bands as they come in: 0 at the lower line, 1 at the upper")}
    >
      <span class="label">visualiser</span>
      <button
        class="toggle"
        aria-pressed={visualiser}
        aria-label="Show the visualiser"
        onclick={() => onvisualiser(!visualiser)}>{visualiser ? "on" : "off"}</button
      >
    </div>
    <!-- Under its switch, so the switch stays where it was pressed -->
    {#if visualiser}
      <div class="meter"><Spectrum {read} /></div>
    {/if}

    <div class="doc">// {hint}</div>
  </section>
{:else}
  <button class="audio meter" title="audio settings" aria-label="Audio settings" onclick={onopen}>
    <Spectrum {read} />
  </button>
{/if}

<style>
  .audio {
    position: fixed;
    top: calc(28px + var(--top-h));
    right: 24px;
    z-index: 20;
    display: block;
    width: 248px;
    max-height: calc(100vh - var(--top-h) - var(--status-h) - 48px);
    overflow-y: auto;
    border: 1px solid var(--violet-edge);
    /*
     * Nodes pass underneath, and shouldn't show through. Just short of solid
     * all the same: behind a solid box this size, headless Chromium cut its
     * hole in the output upside down, under the box's mirror image.
     */
    background: rgba(0, 0, 0, 0.98);
    scrollbar-width: none;
  }

  section.audio {
    border-top: 2px solid var(--category);
  }

  button.audio:hover {
    border-color: var(--text);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 28px;
    padding: 0 10px;
    font-size: 13px;
    font-weight: 500;
  }

  .tag {
    color: var(--dim);
    font-size: 11px;
    font-weight: 400;
  }

  .tag.live {
    color: var(--run);
  }

  section .meter {
    border-top: 1px solid var(--rule);
  }

  .line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    height: var(--row-h);
    padding: 0 4px 0 10px;
    border-top: 1px solid var(--rule);
  }

  .label {
    color: var(--soft);
  }

  select {
    flex: 1;
    min-width: 0;
    height: 20px;
    padding: 0 2px;
    border: 1px solid var(--violet-edge);
    border-radius: 0;
    background: #000;
    color: var(--text);
    font: inherit;
    font-size: 11px;
    text-overflow: ellipsis;
    cursor: pointer;
  }

  .note {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 7px 4px 7px 10px;
    border-top: 1px solid var(--rule);
    color: var(--soft);
    font-size: 11px;
    line-height: 1.3;
  }

  .note span {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .note button,
  .toggle {
    flex: none;
    height: 18px;
    padding: 0 6px;
    border: 1px solid var(--violet-edge);
    font-size: 11px;
  }

  .note button {
    color: var(--text);
  }

  .note button:hover {
    border-color: var(--text);
    background: var(--text);
    color: #000;
  }

  .toggle {
    min-width: 34px;
    background: #000;
  }

  .toggle[aria-pressed="true"] {
    border-color: var(--run);
    background: var(--run);
    color: #000;
    font-weight: 500;
  }

  .doc {
    min-height: 43px;
    padding: 7px 10px;
    border-top: 1px solid var(--rule);
    color: var(--dim);
    font-size: 11px;
    line-height: 1.3;
  }
</style>
