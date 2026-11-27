<script lang="ts">
  import { CATEGORIES, NODE_DEFS, type NodeDef } from "../hydra/catalog";

  interface Props {
    /** Where it opens, in window px */
    x: number;
    y: number;
    /** Which nodes make sense here: after dropping a wire, only ones that can take it */
    accepts?: (def: NodeDef) => boolean;
    onpick: (def: NodeDef) => void;
    onclose: () => void;
  }

  let { x, y, accepts, onpick, onclose }: Props = $props();

  const WIDTH = 232;
  const HEIGHT = 330;

  let query = $state("");
  let index = $state(0);
  let list = $state<HTMLElement>();

  const results = $derived.by(() => {
    const pool = accepts ? NODE_DEFS.filter(accepts) : NODE_DEFS;
    const text = query.trim().toLowerCase();
    if (!text) return pool;
    const starts = pool.filter((def) => def.type.toLowerCase().startsWith(text));
    const contains = pool.filter(
      (def) => !starts.includes(def) && def.type.toLowerCase().includes(text),
    );
    const described = pool.filter(
      (def) => !starts.includes(def) && !contains.includes(def) && def.doc.includes(text),
    );
    return [...starts, ...contains, ...described];
  });

  const current = $derived(results[Math.min(index, results.length - 1)]);
  const left = $derived(Math.max(8, Math.min(x, window.innerWidth - WIDTH - 8)));
  const top = $derived(Math.max(8, Math.min(y, window.innerHeight - HEIGHT - 8)));

  $effect(() => {
    void query;
    index = 0;
  });

  $effect(() => {
    list?.children[Math.min(index, results.length - 1)]?.scrollIntoView({ block: "nearest" });
  });

  function onkeydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      index = (Math.min(index, results.length - 1) + step + results.length) % results.length;
    } else if (event.key === "Enter") {
      if (current) onpick(current);
    } else if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      onclose();
    }
  }

  const focus = (input: HTMLInputElement) => input.focus();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="backdrop"
  onpointerdown={onclose}
  oncontextmenu={(event) => {
    event.preventDefault();
    onclose();
  }}
></div>

<div class="palette" style:left="{left}px" style:top="{top}px" style:width="{WIDTH}px">
  <label class="prompt">
    <span aria-hidden="true">&gt;</span>
    <input
      aria-label="Find a node"
      placeholder="add a node"
      autocomplete="off"
      spellcheck="false"
      bind:value={query}
      {onkeydown}
      use:focus
    />
  </label>
  <div class="list" role="listbox" aria-label="Nodes" bind:this={list}>
    {#each results as def, at (def.type)}
      <button
        role="option"
        aria-selected={def === current}
        onpointermove={() => (index = at)}
        onclick={() => onpick(def)}
      >
        <span class="swatch" style:background={CATEGORIES[def.category].color}></span>
        <span class="type">{def.type}</span>
        <span class="tag">{CATEGORIES[def.category].tag}</span>
      </button>
    {:else}
      <span class="none">// nothing called that</span>
    {/each}
  </div>
  <div class="foot">
    {#if current}// {current.doc}{:else}esc to close{/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
  }

  .palette {
    position: fixed;
    z-index: 41;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--violet-edge);
    background: #000;
  }

  .prompt {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 10px;
    font-size: 13px;
  }

  .prompt span {
    color: var(--run);
  }

  input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: none;
    caret-color: var(--run);
    user-select: text;
    -webkit-user-select: text;
  }

  input::placeholder {
    color: var(--dim);
  }

  .list {
    display: flex;
    flex-direction: column;
    max-height: 252px;
    overflow-y: auto;
    border-top: 1px solid var(--rule);
    scrollbar-width: thin;
    scrollbar-color: var(--dim) transparent;
  }

  .list button {
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 10px;
    text-align: left;
  }

  .list button[aria-selected="true"] {
    background: var(--select);
    color: #fff;
  }

  .swatch {
    flex: none;
    width: 8px;
    height: 8px;
  }

  .type {
    flex: 1;
  }

  .tag {
    color: var(--dim);
    font-size: 11px;
  }

  [aria-selected="true"] .tag {
    color: #fff;
  }

  .none,
  .foot {
    padding: 0 10px;
    color: var(--dim);
    font-size: 11px;
    line-height: 26px;
  }

  .foot {
    overflow: hidden;
    border-top: 1px solid var(--rule);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
