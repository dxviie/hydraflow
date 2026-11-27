<script lang="ts">
  import "@xyflow/svelte/dist/style.css";

  import {
    type Connection,
    Controls,
    type OnBeforeDelete,
    type OnConnectEnd,
    SvelteFlow,
    useSvelteFlow,
  } from "@xyflow/svelte";
  import { onMount, setContext, untrack } from "svelte";

  import {
    type FlowEdge,
    type FlowNode,
    fromSaved,
    newNode,
    toFlowEdge,
    toPatch,
    toPatchEdge,
    toSaved,
  } from "../flow";
  import { compile, signature, toCode } from "../graph/compile";
  import {
    connect,
    downstream,
    insertAfter,
    insertOnEdge,
    removeNode,
    wouldCycle,
  } from "../graph/edit";
  import { History } from "../graph/history";
  import { parsePatch, type SavedPatch, starterPatch } from "../graph/storage";
  import type { InputName, PatchEdge } from "../graph/types";
  import { getDef, type NodeDef } from "../hydra/catalog";
  import { Engine } from "../hydra/engine";
  import CodePane from "./CodePane.svelte";
  import { ENGINE, type EngineContext } from "./context";
  import HydraNode from "./HydraNode.svelte";
  import Palette from "./Palette.svelte";
  import StatusBar from "./StatusBar.svelte";
  import TopBar from "./TopBar.svelte";

  /** Where the palette is, and what the node it adds gets wired to */
  interface PaletteRequest {
    x: number;
    y: number;
    /** Where the new node goes, in patch coordinates */
    position: { x: number; y: number };
    /** A wire was dropped on the canvas: the end it came from */
    from?: { nodeId: string; type: "source" | "target"; input: InputName };
    /** A node was selected: the new one continues its chain */
    after?: string;
    /** A wire was selected: the new one goes into it */
    onEdge?: PatchEdge;
  }

  const STORAGE_KEY = "hydraflow.patch";
  const NODE_WIDTH = 216;
  /** The space between two nodes of a chain */
  const GAP = 74;
  const HEAD_MIDDLE = 16;

  const nodeTypes = { hydra: HydraNode };

  function load(): SavedPatch {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const patch = stored ? parsePatch(JSON.parse(stored)) : undefined;
      if (patch && patch.nodes.length > 0) return patch;
    } catch {
      // Unreadable or blocked storage: start from the starter patch
    }
    return starterPatch();
  }

  const initial = load();
  const start = fromSaved(initial);

  let nodes = $state.raw<FlowNode[]>(start.nodes);
  let edges = $state.raw<FlowEdge[]>(start.edges);
  let shown = $state(initial.shown);
  let codeShown = $state(false);
  let performing = $state(false);
  let paused = $state(false);
  let fps = $state(0);
  let size = $state({ width: 0, height: 0 });
  let palette = $state.raw<PaletteRequest | null>(null);
  let failure = $state("");

  let canvas: HTMLCanvasElement;
  let engine = $state.raw<Engine>();
  const pointer = { x: 0, y: 0, onPane: false };

  setContext<EngineContext>(ENGINE, {
    get current() {
      return engine;
    },
  });

  const flow = useSvelteFlow<FlowNode, FlowEdge>();
  const history = new History<string>();

  const snapshot = () => JSON.stringify(toSaved(nodes, edges, shown));

  const patch = $derived(toPatch(nodes, edges));
  const structure = $derived(signature(patch));
  const code = $derived(codeShown ? toCode(compile(patch), shown) : "");
  const wired = $derived(
    nodes.filter((node) => node.data.fn === "out").map((node) => node.data.option ?? 0),
  );

  // Values go to hydra on every change; shaders are only rebuilt when the wiring changes
  $effect(() => {
    engine?.setParams(patch.nodes);
  });

  $effect(() => {
    void structure;
    const current = engine;
    if (current) untrack(() => current.apply(compile(patch)));
  });

  $effect(() => {
    engine?.show(shown);
  });

  $effect(() => {
    if (engine) engine.paused = paused;
  });

  $effect(() => {
    const saved = snapshot();
    // One step per pause: a whole scrub or drag is undone at once
    const timer = setTimeout(() => {
      history.record(saved);
      try {
        localStorage.setItem(STORAGE_KEY, saved);
      } catch {
        // Storage is full or blocked: the patch lives on in this tab only
      }
    }, 300);
    return () => clearTimeout(timer);
  });

  onMount(() => {
    const measure = () => {
      size = { width: window.innerWidth, height: window.innerHeight };
    };
    measure();
    canvas.width = size.width;
    canvas.height = size.height;

    let created: Engine;
    try {
      created = new Engine(canvas);
    } catch (error) {
      failure = "hydra needs WebGL, and this browser didn't give it one.";
      console.error(error);
      return;
    }
    engine = created;
    created.start();

    const onResize = () => {
      measure();
      created.resize(size.width, size.height);
    };
    window.addEventListener("resize", onResize);
    const meter = setInterval(() => {
      fps = created.fps;
    }, 500);

    return () => {
      window.removeEventListener("resize", onResize);
      clearInterval(meter);
      created.stop();
    };
  });

  const patchEdges = () => edges.map(toPatchEdge);

  const isValidConnection = (connection: Connection | FlowEdge) =>
    !wouldCycle(patchEdges(), connection.source, connection.target);

  // An input holds one wire: plugging another in replaces it
  function onbeforeconnect(connection: Connection) {
    edges = connect(patchEdges(), toPatchEdge(connection)).map(toFlowEdge);
    return null;
  }

  // A wire let go over empty canvas asks what should go there
  const onconnectend: OnConnectEnd = (event, connection) => {
    const { fromNode, fromHandle } = connection;
    if (connection.isValid || connection.toNode || !fromNode || !fromHandle) return;
    const { clientX: x, clientY: y } = "changedTouches" in event ? event.changedTouches[0] : event;
    const at = flow.screenToFlowPosition({ x, y });
    const outgoing = fromHandle.type === "source";
    palette = {
      x,
      y,
      position: { x: outgoing ? at.x : at.x - NODE_WIDTH, y: at.y - HEAD_MIDDLE },
      from: {
        nodeId: fromNode.id,
        type: fromHandle.type,
        input: fromHandle.id === "by" ? "by" : "in",
      },
    };
  };

  // Deleting a node closes the gap it leaves in its chain
  const onbeforedelete: OnBeforeDelete<FlowNode, FlowEdge> = async ({
    nodes: gone,
    edges: goneEdges,
  }) => {
    const ids = new Set(gone.map((node) => node.id));
    const cut = new Set(
      goneEdges
        .filter((edge) => !ids.has(edge.source) && !ids.has(edge.target))
        .map((edge) => edge.id),
    );
    let next = edges.filter((edge) => !cut.has(edge.id)).map(toPatchEdge);
    for (const id of ids) next = removeNode(next, id);
    nodes = nodes.filter((node) => !ids.has(node.id));
    edges = next.map(toFlowEdge);
    return false;
  };

  /** The place right after a node, where its chain continues */
  const slotAfter = (node: FlowNode) => ({
    x: node.position.x + (node.measured?.width ?? NODE_WIDTH) + GAP,
    y: node.position.y,
  });

  /**
   * With one node selected the palette continues its chain, with one wire
   * selected it goes into that wire; otherwise it adds where you point.
   */
  function openPalette(atPointer: boolean) {
    const selected = nodes.filter((node) => node.selected);
    const wires = edges.filter((edge) => edge.selected);
    if (selected.length === 0 && wires.length === 1) {
      const source = nodes.find((node) => node.id === wires[0].source);
      if (source) {
        const position = slotAfter(source);
        const onEdge = toPatchEdge(wires[0]);
        palette = { ...flow.flowToScreenPosition(position), position, after: source.id, onEdge };
        return;
      }
    }
    const anchor = selected.length === 1 ? selected[0] : undefined;
    if (anchor && getDef(anchor.data.fn)?.hasOutput) {
      const position = slotAfter(anchor);
      palette = { ...flow.flowToScreenPosition(position), position, after: anchor.id };
      return;
    }
    const at =
      atPointer && pointer.onPane
        ? { x: pointer.x, y: pointer.y }
        : { x: window.innerWidth / 2 - NODE_WIDTH / 2, y: window.innerHeight / 3 };
    palette = { ...at, position: flow.screenToFlowPosition(at) };
  }

  function accepts(request: PaletteRequest): ((def: NodeDef) => boolean) | undefined {
    if (request.onEdge) return (def) => def.inputs >= 1 && def.hasOutput;
    if (request.from?.type === "source") return (def) => def.inputs >= 1;
    if (request.from?.type === "target") return (def) => def.hasOutput;
    return undefined;
  }

  /** Move what follows `after` along, when the new node would land on it */
  function makeRoom(after: FlowNode, slot: { x: number; y: number }): FlowNode[] {
    const following = downstream(patchEdges(), after.id);
    const crowded = nodes.some(
      (node) =>
        following.has(node.id) &&
        node.position.x >= after.position.x &&
        node.position.x < slot.x + NODE_WIDTH + GAP / 2 &&
        Math.abs(node.position.y - slot.y) < 120,
    );
    if (!crowded) return nodes;
    return nodes.map((node) =>
      following.has(node.id) && node.position.x >= after.position.x
        ? { ...node, position: { ...node.position, x: node.position.x + NODE_WIDTH + GAP } }
        : node,
    );
  }

  function pick(def: NodeDef) {
    const request = palette;
    if (!request) return;
    palette = null;

    let position = request.position;
    let next = patchEdges();
    let others = nodes;
    const anchor = request.after ? nodes.find((node) => node.id === request.after) : undefined;
    const node = newNode(def, position);

    if (anchor && request.onEdge) {
      others = makeRoom(anchor, position);
      next = insertOnEdge(next, request.onEdge, node.id);
    } else if (anchor && def.inputs >= 1) {
      // A transform joins the chain; an `out` taps it and leaves the chain as it was
      if (def.hasOutput) others = makeRoom(anchor, position);
      next = insertAfter(next, anchor.id, node.id, def.hasOutput);
    } else if (anchor) {
      // A source can't continue a chain: it goes underneath, ready to be mixed in
      position = {
        x: anchor.position.x,
        y: anchor.position.y + (anchor.measured?.height ?? 120) + 40,
      };
    } else if (request.from?.type === "source") {
      next = connect(next, { source: request.from.nodeId, target: node.id, input: "in" });
    } else if (request.from?.type === "target") {
      const { nodeId: target, input } = request.from;
      next = connect(next, { source: node.id, target, input });
    }

    nodes = [
      ...others.map((other) => (other.selected ? { ...other, selected: false } : other)),
      { ...node, position, selected: true },
    ];
    edges = next.map(toFlowEdge);
  }

  function restore(saved: string) {
    const restored = parsePatch(JSON.parse(saved));
    if (!restored) return;
    ({ nodes, edges } = fromSaved(restored));
    shown = restored.shown;
  }

  function undo() {
    // Whatever changed since the last pause is a step too
    history.record(snapshot());
    const previous = history.undo();
    if (previous) restore(previous);
  }

  function redo() {
    const next = history.redo();
    if (next) restore(next);
  }

  function reset() {
    if (!window.confirm("Replace this patch with the starter patch?")) return;
    const fresh = starterPatch();
    ({ nodes, edges } = fromSaved(fresh));
    shown = fresh.shown;
    flow.fitView({ padding: 0.3, maxZoom: 1 });
  }

  function onkeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key === "`") {
      event.preventDefault();
      performing = !performing;
      return;
    }
    if (event.key === "Escape" && performing) {
      performing = false;
      return;
    }
    const target = event.target as HTMLElement | null;
    if (performing || palette || target?.closest("input, textarea, [contenteditable]")) return;
    if (event.key === "Tab") {
      event.preventDefault();
      openPalette(true);
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
    }
  }

  function onpointermove(event: PointerEvent) {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.onPane = (event.target as HTMLElement | null)?.closest(".svelte-flow") != null;
  }
</script>

<svelte:window {onkeydown} {onpointermove} />

<canvas bind:this={canvas} class="output" aria-label="What the patch draws"></canvas>
<div class="scrim" class:off={performing}></div>

<div class="patch" class:hidden={performing}>
  <SvelteFlow
    bind:nodes
    bind:edges
    {nodeTypes}
    fitView
    fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
    minZoom={0.25}
    maxZoom={2}
    forceColorMode="dark"
    zoomOnDoubleClick={false}
    deleteKey={["Backspace", "Delete"]}
    attributionPosition="bottom-right"
    {isValidConnection}
    {onbeforeconnect}
    {onconnectend}
    {onbeforedelete}
    onpaneclick={({ event }) => {
      if (event.detail === 2) openPalette(true);
    }}
  >
    <Controls position="bottom-right" showLock={false} />
  </SvelteFlow>
</div>

{#if performing}
  <button class="back" onclick={() => (performing = false)}>esc to edit</button>
{:else}
  <TopBar
    {codeShown}
    onadd={() => openPalette(false)}
    oncode={() => (codeShown = !codeShown)}
    onreset={reset}
    onperform={() => (performing = true)}
  />
  {#if codeShown}
    <CodePane {code} />
  {/if}
  <StatusBar
    {paused}
    nodes={nodes.length}
    {shown}
    {wired}
    {fps}
    width={size.width}
    height={size.height}
    onpause={() => (paused = !paused)}
    onshow={(buffer) => (shown = buffer)}
  />
{/if}

{#if palette}
  {@const request = palette}
  <Palette
    x={request.x}
    y={request.y}
    accepts={accepts(request)}
    onpick={pick}
    onclose={() => (palette = null)}
  />
{/if}

{#if failure}
  <p class="failure" role="alert">{failure}</p>
{/if}

<style>
  .output {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    background: #000;
  }

  /* The visuals play at full strength only when performing: behind a patch they step back */
  .scrim {
    position: fixed;
    inset: 0;
    background: var(--bg);
    opacity: 0.5;
    pointer-events: none;
    transition: opacity 0.3s;
  }

  .scrim.off {
    opacity: 0;
  }

  .patch {
    position: fixed;
    inset: 0;
  }

  .patch.hidden {
    display: none;
  }

  .back {
    position: fixed;
    left: 24px;
    bottom: 20px;
    padding: 6px 10px;
    background: var(--box);
    color: var(--dim);
    opacity: 0;
    animation: hint 4s;
  }

  .back:hover,
  .back:focus-visible {
    opacity: 1;
    color: var(--text);
  }

  @keyframes hint {
    0%,
    70% {
      opacity: 1;
    }
  }

  .failure {
    position: fixed;
    top: 50%;
    left: 50%;
    margin: 0;
    padding: 12px 16px;
    transform: translate(-50%, -50%);
    background: var(--box);
    line-height: 1.5;
  }
</style>
