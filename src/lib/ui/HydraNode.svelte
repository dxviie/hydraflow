<script lang="ts">
  import {
    Handle,
    type NodeProps,
    Position,
    useNodeConnections,
    useNodesData,
    useSvelteFlow,
    useUpdateNodeInternals,
  } from "@xyflow/svelte";
  import { getContext, tick } from "svelte";

  import type { FlowNode } from "../flow";
  import { nodeCode } from "../graph/compile";
  import type { ParamState } from "../graph/types";
  import { CATEGORIES, getDef } from "../hydra/catalog";
  import { PREVIEW_HEIGHT, PREVIEW_WIDTH } from "../hydra/engine";
  import { ENGINE, type EngineContext } from "./context";
  import ParamRow from "./ParamRow.svelte";

  let { id, data, selected = false }: NodeProps<FlowNode> = $props();

  const { updateNodeData } = useSvelteFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const engine = getContext<EngineContext>(ENGINE);

  const def = $derived(getDef(data.fn));
  const category = $derived(def && CATEGORIES[def.category]);
  const collapsed = $derived(data.collapsed === true);
  const showAll = $derived(selected || data.more === true);
  const shownParams = $derived(
    def ? (showAll ? def.params : def.params.slice(0, def.primary)) : [],
  );
  const hidden = $derived(def ? def.params.length - shownParams.length : 0);
  const showPreview = $derived(!collapsed && data.preview === true);

  // What is plugged into the second input, to name it on the "by" row
  const mixed = useNodeConnections(() => ({ handleType: "target", handleId: "by" }));
  const mixedNode = useNodesData<FlowNode>(() => ({ nodeIds: mixed.current[0]?.source }));

  let canvas = $state<HTMLCanvasElement>();

  $effect(() => {
    const current = engine.current;
    if (!current || !canvas) return;
    current.attachPreview(id, canvas);
    return () => current.detachPreview(id);
  });

  // The sockets move when the node changes shape: tell Svelte Flow where they went.
  // Not on the way in: Svelte Flow measures a new node itself, and fits the view after.
  let measured = false;
  $effect(() => {
    void [collapsed, showAll, showPreview];
    if (measured) tick().then(() => updateNodeInternals(id));
    measured = true;
  });

  function setParam(name: string, param: ParamState) {
    updateNodeData(id, { params: { ...data.params, [name]: param } });
  }

  const paramOf = (name: string, fallback: number): ParamState =>
    data.params[name] ?? { value: fallback };
</script>

{#if def && category}
  <div class="node" class:selected class:collapsed style:--category={category.color}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="head"
      title={collapsed ? "double-click to open" : "double-click to fold into one line"}
      ondblclick={() => updateNodeData(id, { collapsed: !collapsed })}
    >
      {#if collapsed}
        <span class="name line">{nodeCode({ id, ...data }, def)}</span>
      {:else}
        <span class="name">{def.type}</span>
      {/if}
      {#if selected && !collapsed}
        <button
          class="tool nodrag"
          class:on={data.preview}
          aria-pressed={data.preview === true}
          title="show what the picture looks like at this point of the chain"
          onclick={() => updateNodeData(id, { preview: !data.preview })}>preview</button
        >
      {:else}
        <span class="tag">{category.tag}</span>
      {/if}
    </div>

    {#if !collapsed}
      {#if def.inputs === 2}
        <div class="row by">
          <span class="label">by</span>
          <span class:open={!mixedNode.current}>{mixedNode.current?.data.fn ?? "nothing yet"}</span>
          <Handle type="target" position={Position.Left} id="by" />
        </div>
      {/if}

      {#if def.options}
        <div class="options nodrag" role="group" aria-label="{def.type} uses">
          {#each def.options as option, index (option)}
            <button
              aria-pressed={(data.option ?? 0) === index}
              onclick={() => updateNodeData(id, { option: index })}>{option}</button
            >
          {/each}
        </div>
      {/if}

      {#each shownParams as param (param.name)}
        <ParamRow
          def={param}
          param={paramOf(param.name, param.default)}
          active={selected}
          onchange={(next) => setParam(param.name, next)}
        />
      {/each}

      {#if hidden > 0}
        <button class="more nodrag" onclick={() => updateNodeData(id, { more: true })}
          >+ {hidden} more</button
        >
      {:else if data.more && !selected && def.params.length > def.primary}
        <button class="more nodrag" onclick={() => updateNodeData(id, { more: false })}>− less</button>
      {/if}

      {#if showPreview}
        <canvas
          bind:this={canvas}
          class="preview"
          width={PREVIEW_WIDTH}
          height={PREVIEW_HEIGHT}
          aria-label="What {def.type} looks like"
        ></canvas>
      {/if}

      {#if selected}
        <div class="doc">// {def.doc}</div>
      {/if}
    {/if}

    {#if def.inputs >= 1}
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        class={def.inputs === 2 && collapsed ? "main paired" : "main"}
      />
    {/if}
    {#if def.inputs === 2 && collapsed}
      <Handle type="target" position={Position.Left} id="by" class="folded" />
    {/if}
    {#if def.hasOutput}
      <Handle type="source" position={Position.Right} id="out" class="main" />
    {/if}
  </div>
{/if}

<style>
  .node {
    position: relative;
    width: 216px;
    border: 1px solid var(--violet-line);
    border-top: 2px solid var(--category);
    background: var(--box);
  }

  .node.selected {
    border-color: var(--select);
    border-top-color: var(--category);
    box-shadow: 0 0 0 1px var(--select);
    background: rgba(0, 0, 0, 0.92);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    height: 28px;
    padding: 0 10px;
    font-size: 13px;
    font-weight: 500;
  }

  .selected .head {
    background: rgba(144, 0, 255, 0.4);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name.line {
    font-weight: 400;
  }

  .tag {
    color: var(--dim);
    font-size: 11px;
    font-weight: 400;
  }

  .tool {
    height: 18px;
    padding: 0 6px;
    border: 1px solid rgba(243, 243, 239, 0.5);
    font-size: 11px;
    font-weight: 400;
  }

  .tool.on {
    border-color: var(--run);
    background: var(--run);
    color: #000;
  }

  .row {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: var(--row-h);
    padding: 0 10px;
    border-top: 1px solid var(--rule);
  }

  .label {
    color: var(--soft);
  }

  .open {
    color: var(--dim);
  }

  .options {
    display: flex;
    height: var(--row-h);
    border-top: 1px solid var(--rule);
  }

  .options button {
    flex: 1;
    color: var(--soft);
  }

  .options button:hover {
    color: var(--text);
  }

  .options button[aria-pressed="true"] {
    background: var(--text);
    color: #000;
    font-weight: 500;
  }

  .more {
    display: block;
    width: 100%;
    height: 22px;
    padding: 0 10px;
    border-top: 1px solid var(--rule);
    color: var(--dim);
    font-size: 11px;
    text-align: left;
  }

  .more:hover {
    color: var(--text);
  }

  .preview {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 9;
    border-top: 1px solid var(--rule);
    background: #000;
    /* WebGL reads back bottom row first */
    transform: scaleY(-1);
  }

  .doc {
    padding: 7px 10px;
    border-top: 1px solid var(--rule);
    color: var(--dim);
    font-size: 11px;
    line-height: 1.3;
  }

  /* The chain runs through the title: in on the left, out on the right */
  .node :global(.svelte-flow__handle.main) {
    top: 14px;
  }

  /* Folded, a node that mixes shows both inputs on its one line */
  .node :global(.svelte-flow__handle.paired) {
    top: 7px;
  }

  .node :global(.svelte-flow__handle.folded) {
    top: 21px;
  }
</style>
