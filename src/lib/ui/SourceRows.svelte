<script lang="ts">
  import { getContext } from "svelte";

  import type { HydraNodeData } from "../flow";
  import type { NodeDef } from "../hydra/catalog";
  import { EDITOR, type EditorContext } from "./context";

  interface Props {
    id: string;
    def: NodeDef;
    data: HydraNodeData;
  }

  let { id, def, data }: Props = $props();

  const editor = getContext<EditorContext>(EDITOR);

  let picker = $state<HTMLInputElement>();

  const status = $derived(editor.status(id));
  const plays = $derived(def.source === "image" || def.source === "video");

  /** What went wrong or what is missing, in a line */
  const note = $derived.by(() => {
    if (editor.crowded(id)) return "hydra has four inputs: this one has none left";
    if (status === "loading") return "opening…";
    if (status === "missing")
      return `${data.media?.name ?? "the file"} isn't in this browser: choose it again`;
    if (status !== "error") return "";
    if (def.source === "cam") return "no camera there, or not allowed";
    if (def.source === "screen") return "that could not be shared";
    return "that file could not be played";
  });

  function onpick() {
    const file = picker?.files?.[0];
    if (file) editor.attach(id, file);
    // Choosing the same file again should count too
    if (picker) picker.value = "";
  }
</script>

{#if def.source === "screen"}
  <div class="row nodrag">
    {#if status === "live"}
      <span class="label">sharing</span>
      <button onclick={() => editor.engine?.stopSource(id)}>stop</button>
    {:else}
      <span class="label">nothing yet</span>
      <button onclick={() => editor.engine?.startScreen(id)}>pick a screen</button>
    {/if}
  </div>
{:else if plays}
  <div class="row nodrag">
    <span class="file" class:none={!data.media} title={data.media?.name}
      >{data.media?.name ?? "no file yet"}</span
    >
    <button onclick={() => picker?.click()}>{data.media ? "change" : "choose"}</button>
    <input
      bind:this={picker}
      type="file"
      accept="{def.source}/*"
      aria-label="A file for {def.type}"
      hidden
      onchange={onpick}
    />
  </div>
{/if}

{#if note}
  <div class="note" role="status">// {note}</div>
{/if}

<style>
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    height: var(--row-h);
    padding: 0 4px 0 10px;
    border-top: 1px solid var(--rule);
  }

  .label,
  .none {
    color: var(--dim);
  }

  .file {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  button {
    flex: none;
    height: 18px;
    padding: 0 6px;
    border: 1px solid var(--violet-edge);
    font-size: 11px;
  }

  button:hover {
    border-color: var(--text);
    background: var(--text);
    color: #000;
  }

  .note {
    padding: 7px 10px;
    border-top: 1px solid var(--rule);
    color: var(--soft);
    font-size: 11px;
    line-height: 1.3;
  }
</style>
