<script lang="ts">
  import { untrack } from "svelte";

  import { driveLabel, formatNumber } from "../graph/params";
  import type { ParamState } from "../graph/types";
  import type { ParamDef } from "../hydra/catalog";
  import DrivePanel from "./DrivePanel.svelte";
  import { scrub, snap } from "./scrub";

  interface Props {
    def: ParamDef;
    param: ParamState;
    /** The node is selected: the row offers what drives it */
    active: boolean;
    onchange: (param: ParamState) => void;
  }

  let { def, param, active, onchange }: Props = $props();

  let open = $state(false);
  let editing = $state(false);
  let draft = $state("");

  const drive = $derived(param.drive);

  /** Where a value sits in the row, 0 to 100 */
  const place = (value: number) =>
    Math.min(1, Math.max(0, (value - def.min) / (def.max - def.min))) * 100;

  // The bar grows from zero: from the left edge, or from the middle of a range that goes negative
  const fill = $derived.by(() => {
    const zero = place(0);
    const at = place(param.value);
    return { left: Math.min(zero, at), width: Math.abs(at - zero) };
  });

  // The drive panel belongs to a selected node: it closes when the node is left
  $effect(() => {
    if (!active) untrack(() => (open = false));
  });

  const setValue = (value: number) => onchange({ ...param, value });

  function edit() {
    if (drive) return;
    draft = formatNumber(param.value);
    editing = true;
  }

  function commit() {
    if (!editing) return;
    editing = false;
    const typed = Number.parseFloat(draft);
    if (Number.isFinite(typed)) setValue(typed);
  }

  function onInputKey(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === "Enter") commit();
    if (event.key === "Escape") editing = false;
  }

  function onRowKey(event: KeyboardEvent) {
    if (drive || editing) return;
    const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (direction !== 0) {
      event.preventDefault();
      event.stopPropagation();
      setValue(snap(param.value + direction * def.step * (event.shiftKey ? 10 : 1), def.step));
    } else if (event.key === "Enter") {
      event.stopPropagation();
      edit();
    }
  }

  const focus = (input: HTMLInputElement) => input.select();
</script>

<div
  class="row nodrag nopan"
  class:driven={drive}
  role="slider"
  tabindex="0"
  aria-label={def.name}
  aria-valuemin={def.min}
  aria-valuemax={def.max}
  aria-valuenow={param.value}
  title={drive ? undefined : "drag to change, double-click to type"}
  ondblclick={edit}
  onkeydown={onRowKey}
  use:scrub={{
    value: param.value,
    min: def.min,
    max: def.max,
    step: def.step,
    disabled: drive !== undefined || editing,
    onchange: setValue,
  }}
>
  {#if !drive}
    <span class="fill" style:left="{fill.left}%" style:width="{fill.width}%"></span>
  {/if}
  <span class="name">{def.name}</span>
  {#if editing}
    <input
      aria-label={def.name}
      inputmode="decimal"
      bind:value={draft}
      onblur={commit}
      onkeydown={onInputKey}
      use:focus
    />
  {:else if drive}
    <span class="value">~ {driveLabel(drive)}</span>
  {:else}
    <span class="value">{formatNumber(param.value)}</span>
  {/if}
  {#if active || drive}
    <button
      class="drive"
      class:on={drive}
      aria-label="What drives {def.name}"
      aria-expanded={open}
      title="make it move: sequence, lfo, audio or mouse"
      onclick={() => (open = !open)}>~</button
    >
  {/if}
</div>
{#if open}
  <DrivePanel {def} {param} {onchange} />
{/if}

<style>
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    height: var(--row-h);
    padding: 0 10px;
    border-top: 1px solid var(--rule);
    cursor: ew-resize;
  }

  .row.driven {
    cursor: default;
  }

  .fill {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--select-fill);
    pointer-events: none;
  }

  .name {
    position: relative;
    flex: 1;
    overflow: hidden;
    color: var(--soft);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .value {
    position: relative;
    color: var(--num);
    white-space: nowrap;
  }

  input {
    position: relative;
    width: 72px;
    height: 20px;
    padding: 0 4px;
    border: 1px solid var(--num);
    background: #000;
    color: var(--num);
    text-align: right;
    user-select: text;
    -webkit-user-select: text;
  }

  .drive {
    position: relative;
    flex: none;
    width: 18px;
    height: 18px;
    margin-right: -6px;
    border: 1px solid var(--violet-edge);
    background: var(--bg);
    color: var(--num);
  }

  .drive:hover,
  .drive.on {
    border-color: var(--num);
    background: var(--num);
    color: #000;
  }
</style>
