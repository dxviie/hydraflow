<script lang="ts">
  import {
    Handle,
    type NodeProps,
    Position,
    useConnection,
    useNodeConnections,
    useNodesData,
    useSvelteFlow,
    useUpdateNodeInternals,
  } from "@xyflow/svelte";
  import { getContext, tick } from "svelte";

  import type { FlowNode } from "../flow";
  import { controlCode, nodeCode, type WireNames } from "../graph/compile";
  import { controlDrive } from "../graph/params";
  import { inputParam, type ParamState, paramInput } from "../graph/types";
  import { CATEGORIES, getDef, type ParamDef } from "../hydra/catalog";
  import { PREVIEW_HEIGHT, PREVIEW_WIDTH } from "../hydra/engine";
  import { EDITOR, type EditorContext } from "./context";
  import ParamRow from "./ParamRow.svelte";
  import Scope from "./Scope.svelte";
  import SourceRows from "./SourceRows.svelte";

  let { id, data, selected = false }: NodeProps<FlowNode> = $props();

  const { updateNodeData } = useSvelteFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const editor = getContext<EditorContext>(EDITOR);

  const def = $derived(getDef(data.fn));
  const category = $derived(def && CATEGORIES[def.category]);
  const collapsed = $derived(data.collapsed === true);
  const showAll = $derived(selected || data.more === true);
  const showPreview = $derived(!collapsed && data.preview === true);

  // What is plugged into the second input, to name it on the "by" row
  const incoming = useNodeConnections(() => ({ handleType: "target" }));
  const mixedNode = useNodesData<FlowNode>(() => ({
    nodeIds: incoming.current.find((wire) => wire.targetHandle === "by")?.source,
  }));

  /** The control wired into each parameter that has one, by parameter name */
  const wires = $derived.by(() => {
    const found: WireNames = {};
    for (const wire of incoming.current) {
      const param = inputParam(wire.targetHandle ?? "");
      const name = param === undefined ? undefined : editor.controlName(wire.source);
      if (param !== undefined && name) found[param] = { name };
    }
    return found;
  });

  // At rest: the main parameters, and any other a control is wired into
  const shownParams = $derived(
    def ? def.params.filter((param, at) => showAll || at < def.primary || param.name in wires) : [],
  );
  const hidden = $derived(def ? def.params.length - shownParams.length : 0);

  /* ── A control node: a number, the function that makes it, and what it reaches ── */

  const control = $derived(
    def?.control
      ? {
          name: editor.controlName(id) ?? def.type,
          drive: controlDrive(def.control, { id, ...data }),
        }
      : undefined,
  );

  // Its from and to scrub in the range of the parameters it is wired into
  const feeds = useNodeConnections(() => ({ handleType: "source" }));
  const fed = useNodesData<FlowNode>(() => ({ nodeIds: feeds.current.map((wire) => wire.target) }));
  const reach = $derived.by(() => {
    let range: { min: number; max: number; step: number } | undefined;
    for (const wire of feeds.current) {
      const target = fed.current.find((node) => node.id === wire.target);
      const name = inputParam(wire.targetHandle ?? "");
      const param = target && getDef(target.data.fn)?.params.find((known) => known.name === name);
      if (!param) continue;
      range = {
        min: Math.min(param.min, range?.min ?? param.min),
        max: Math.max(param.max, range?.max ?? param.max),
        step: Math.min(param.step, range?.step ?? param.step),
      };
    }
    return range;
  });
  const settingDef = (param: ParamDef): ParamDef =>
    reach && (param.name === "min" || param.name === "max") ? { ...param, ...reach } : param;

  // While a number is being dragged out of a control, every parameter shows where it can go
  const connection = useConnection();
  const offering = $derived.by(() => {
    const dragged = connection.current;
    return dragged.inProgress && Boolean(getDef(String(dragged.fromNode.data.fn))?.control);
  });

  let copied = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  async function copyCode() {
    if (!control) return;
    try {
      await navigator.clipboard.writeText(controlCode(control));
      copied = true;
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => (copied = false), 1500);
    } catch {
      copied = false;
    }
  }

  let canvas = $state<HTMLCanvasElement>();

  $effect(() => {
    const current = editor.engine;
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
  <div
    class="node"
    class:selected
    class:collapsed
    class:offering
    style:--category={category.color}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="head"
      title={collapsed ? "double-click to open" : "double-click to fold into one line"}
      ondblclick={() => updateNodeData(id, { collapsed: !collapsed })}
    >
      {#if collapsed}
        <span class="name line"
          >{control ? `${control.name} = ` : ""}{nodeCode({ id, ...data }, def, wires)}</span
        >
      {:else}
        <span class="name">{control?.name ?? def.type}</span>
      {/if}
      {#if selected && !collapsed && !control}
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

      {#if def.source}
        <SourceRows {id} {def} {data} />
      {/if}

      {#each shownParams as param (param.name)}
        <ParamRow
          def={control ? settingDef(param) : param}
          param={paramOf(param.name, param.default)}
          active={selected}
          wired={wires[param.name]?.name}
          plain={control !== undefined}
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

      {#if control}
        <Scope
          read={() => editor.engine?.controlValue(id)}
          min={control.drive.min}
          max={control.drive.max}
        />
        {#if selected}
          <div class="code nodrag nopan">
            <code>{controlCode(control)}</code>
            <button onclick={copyCode}>{copied ? "copied" : "copy"}</button>
          </div>
        {/if}
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
    {#if collapsed}
      <!-- Folded, the wires into its parameters still need somewhere to end -->
      {#each Object.keys(wires) as param (param)}
        <Handle type="target" position={Position.Left} id={paramInput(param)} class="folded value" />
      {/each}
    {/if}
    {#if def.hasOutput}
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        class={control ? "main value" : "main"}
      />
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
  }

  /* The function a control node is, to read and to take along */
  .code {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 7px 4px 7px 10px;
    border-top: 1px solid var(--rule);
    cursor: text;
  }

  .code code {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: 11px;
    line-height: 1.45;
    overflow-wrap: anywhere;
    user-select: text;
    -webkit-user-select: text;
  }

  .code button {
    flex: none;
    height: 18px;
    padding: 0 6px;
    border: 1px solid var(--violet-edge);
    font-size: 11px;
  }

  .code button:hover {
    border-color: var(--text);
    background: var(--text);
    color: #000;
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
