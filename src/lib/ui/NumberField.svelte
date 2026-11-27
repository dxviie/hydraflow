<script lang="ts">
  import { formatNumber } from "../graph/params";
  import { scrub } from "./scrub";

  interface Props {
    value: number;
    min: number;
    max: number;
    step: number;
    label: string;
    onchange: (value: number) => void;
  }

  let { value, min, max, step, label, onchange }: Props = $props();

  let editing = $state(false);
  let draft = $state("");

  function edit() {
    draft = formatNumber(value);
    editing = true;
  }

  function commit() {
    if (!editing) return;
    editing = false;
    const typed = Number.parseFloat(draft);
    if (Number.isFinite(typed)) onchange(typed);
  }

  function onkeydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === "Enter") commit();
    if (event.key === "Escape") editing = false;
  }

  const focus = (input: HTMLInputElement) => input.select();
</script>

{#if editing}
  <input
    class="field nodrag"
    aria-label={label}
    inputmode="decimal"
    bind:value={draft}
    onblur={commit}
    {onkeydown}
    use:focus
  />
{:else}
  <span
    class="field nodrag nopan"
    role="spinbutton"
    tabindex="0"
    aria-label={label}
    aria-valuenow={value}
    title="drag to change, double-click to type"
    ondblclick={edit}
    onkeydown={(event) => event.key === "Enter" && edit()}
    use:scrub={{ value, min, max, step, onchange }}
  >
    {formatNumber(value)}
  </span>
{/if}

<style>
  .field {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    height: 24px;
    padding: 0 6px;
    border: 1px solid var(--violet-edge);
    background: #000;
    color: var(--num);
    cursor: ew-resize;
  }

  input.field {
    width: 44px;
    text-align: center;
    cursor: text;
    user-select: text;
    -webkit-user-select: text;
  }
</style>
