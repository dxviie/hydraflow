<script lang="ts">
  import { getContext } from "svelte";

  import { DRIVE_MODES, defaultDrive, driveCode, WAVES } from "../graph/params";
  import type { Drive, DriveMode, ParamState } from "../graph/types";
  import type { ParamDef } from "../hydra/catalog";
  import { EDITOR, type EditorContext } from "./context";
  import NumberField from "./NumberField.svelte";

  interface Props {
    def: ParamDef;
    param: ParamState;
    onchange: (param: ParamState) => void;
  }

  let { def, param, onchange }: Props = $props();

  const MAX_STEPS = 8;

  // As many bands as the patch cuts the sound into
  const editor = getContext<EditorContext>(EDITOR);
  const bins = $derived(Array.from({ length: editor.audio.bins }, (_, bin) => bin));

  const drive = $derived(param.drive);

  function setMode(mode: DriveMode | "value") {
    if (mode === "value") onchange({ value: param.value });
    else if (drive?.mode !== mode) {
      onchange({ value: param.value, drive: defaultDrive(mode, param.value, def.min, def.max) });
    }
  }

  function set(next: Drive) {
    onchange({ value: param.value, drive: next });
  }
</script>

{#snippet range(current: Extract<Drive, { min: number }>)}
  <div class="line">
    <span class="label">from</span>
    <NumberField
      label="{def.name} from"
      value={current.min}
      min={def.min}
      max={def.max}
      step={def.step}
      onchange={(min) => set({ ...current, min })}
    />
    <span class="label">to</span>
    <NumberField
      label="{def.name} to"
      value={current.max}
      min={def.min}
      max={def.max}
      step={def.step}
      onchange={(max) => set({ ...current, max })}
    />
  </div>
{/snippet}

<div class="panel nodrag nopan">
  <div class="tabs" role="group" aria-label="What drives {def.name}">
    <button aria-pressed={!drive} onclick={() => setMode("value")}>value</button>
    {#each DRIVE_MODES as mode (mode)}
      <button aria-pressed={drive?.mode === mode} onclick={() => setMode(mode)}>{mode}</button>
    {/each}
  </div>

  {#if !drive}
    <span class="hint">// pick what moves {def.name}</span>
  {:else if drive.mode === "seq"}
    <div class="line steps">
      {#each drive.values as step, index (index)}
        <NumberField
          label="{def.name} step {index + 1}"
          value={step}
          min={def.min}
          max={def.max}
          step={def.step}
          onchange={(value) => set({ ...drive, values: drive.values.with(index, value) })}
        />
      {/each}
      {#if drive.values.length > 1}
        <button
          class="square"
          aria-label="Remove the last step"
          onclick={() => set({ ...drive, values: drive.values.slice(0, -1) })}>−</button
        >
      {/if}
      {#if drive.values.length < MAX_STEPS}
        <button
          class="square dashed"
          aria-label="Add a step"
          onclick={() => set({ ...drive, values: [...drive.values, drive.values.at(-1) ?? 0] })}
          >+</button
        >
      {/if}
    </div>
    <div class="line">
      <span class="label">fast</span>
      <NumberField
        label="{def.name} sequence speed"
        value={drive.fast}
        min={0}
        max={8}
        step={0.05}
        onchange={(fast) => set({ ...drive, fast })}
      />
      <span class="label">smooth</span>
      <button
        class="toggle"
        aria-pressed={drive.smooth}
        onclick={() => set({ ...drive, smooth: !drive.smooth })}>{drive.smooth ? "on" : "off"}</button
      >
    </div>
  {:else if drive.mode === "lfo"}
    <div class="tabs" role="group" aria-label="Wave">
      {#each WAVES as wave (wave)}
        <button aria-pressed={drive.wave === wave} onclick={() => set({ ...drive, wave })}
          >{wave}</button
        >
      {/each}
    </div>
    <div class="line">
      <span class="label">rate</span>
      <NumberField
        label="{def.name} lfo rate"
        value={drive.rate}
        min={0}
        max={4}
        step={0.01}
        onchange={(rate) => set({ ...drive, rate })}
      />
      <span class="label">hz</span>
    </div>
    {@render range(drive)}
  {:else if drive.mode === "audio"}
    <div class="tabs" role="group" aria-label="Audio band">
      <span class="label">band</span>
      {#each bins as bin (bin)}
        <button aria-pressed={drive.bin === bin} onclick={() => set({ ...drive, bin })}>{bin}</button>
      {/each}
    </div>
    {@render range(drive)}
  {:else if drive.mode === "mouse"}
    <div class="tabs" role="group" aria-label="Mouse axis">
      <span class="label">axis</span>
      <button aria-pressed={drive.axis === "x"} onclick={() => set({ ...drive, axis: "x" })}>x</button>
      <button aria-pressed={drive.axis === "y"} onclick={() => set({ ...drive, axis: "y" })}>y</button>
    </div>
    {@render range(drive)}
  {/if}

  {#if drive}
    <span class="code" title={driveCode(drive)}>{driveCode(drive)}</span>
  {/if}
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 10px 10px;
    border-top: 1px solid var(--violet-line);
    background: rgba(144, 0, 255, 0.16);
    font-size: 11px;
    cursor: default;
  }

  .tabs,
  .line {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .line {
    gap: 6px;
  }

  .steps {
    flex-wrap: wrap;
    gap: 4px;
  }

  .tabs button {
    height: 20px;
    padding: 0 5px;
    color: var(--soft);
  }

  .tabs button:hover {
    color: var(--text);
  }

  .tabs button[aria-pressed="true"] {
    background: var(--num);
    color: #000;
    font-weight: 500;
  }

  .label,
  .hint {
    color: var(--soft);
  }

  .tabs .label {
    margin-right: 4px;
  }

  .square {
    width: 24px;
    height: 24px;
    border: 1px solid var(--violet-edge);
    background: #000;
  }

  .dashed {
    border: 1px dashed rgba(243, 243, 239, 0.5);
    background: none;
  }

  .toggle {
    height: 20px;
    padding: 0 8px;
    border: 1px solid var(--violet-edge);
    background: #000;
  }

  .toggle[aria-pressed="true"] {
    border-color: var(--run);
    background: var(--run);
    color: #000;
    font-weight: 500;
  }

  .code {
    overflow: hidden;
    color: var(--soft);
    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
