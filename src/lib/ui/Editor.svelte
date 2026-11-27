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
  import type { InputName, MediaRef, PatchEdge } from "../graph/types";
  import { getDef, MAX_SOURCES, type NodeDef } from "../hydra/catalog";
  import { Engine, type SourceStatus } from "../hydra/engine";
  import { loadMedia, mediaKind, pruneMedia, saveMedia } from "../media";
  import { decodePatch, encodePatch, linkedPatch, shareUrl } from "../share";
  import CodePane from "./CodePane.svelte";
  import { EDITOR, type EditorContext } from "./context";
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

  /** Something to tell the person, in the status line, with at most one thing to do about it */
  interface Notice {
    text: string;
    action?: { label: string; run: () => void };
  }

  const STORAGE_KEY = "hydraflow.patch";
  /** The person's own patch, set aside while they look at one from a link */
  const MINE_KEY = "hydraflow.patch.mine";
  const NODE_WIDTH = 216;
  /** The space between two nodes of a chain */
  const GAP = 74;
  const HEAD_MIDDLE = 16;

  const nodeTypes = { hydra: HydraNode };

  function stored(key: string): SavedPatch | undefined {
    try {
      const text = localStorage.getItem(key);
      return text ? parsePatch(JSON.parse(text)) : undefined;
    } catch {
      // Unreadable or blocked storage
      return undefined;
    }
  }

  function load(): SavedPatch {
    const patch = stored(STORAGE_KEY);
    return patch && patch.nodes.length > 0 ? patch : starterPatch();
  }

  /** The files a patch names */
  const mediaOf = (patch: SavedPatch | undefined) =>
    (patch?.nodes ?? []).flatMap((node) => (node.media ? [node.media.id] : []));

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
  let notice = $state.raw<Notice | null>(null);
  let statuses = $state<Record<string, SourceStatus>>({});

  let canvas: HTMLCanvasElement;
  let engine = $state.raw<Engine>();
  const pointer = { x: 0, y: 0, onPane: false };

  const flow = useSvelteFlow<FlowNode, FlowEdge>();
  const history = new History<string>();

  const snapshot = () => JSON.stringify(toSaved(nodes, edges, shown));
  const deselected = (node: FlowNode) => (node.selected ? { ...node, selected: false } : node);

  /** The starter patch as it saves: a patch nobody has touched yet */
  const untouched = fromSaved(starterPatch());
  const pristine = JSON.stringify(toSaved(untouched.nodes, untouched.edges, 0));

  const patch = $derived(toPatch(nodes, edges));
  const structure = $derived(signature(patch));
  const code = $derived(codeShown ? toCode(compile(patch), shown) : "");
  const wired = $derived(
    nodes.filter((node) => node.data.fn === "out").map((node) => node.data.option ?? 0),
  );
  // hydra has four inputs: the input nodes after the fourth have nothing to play on
  const crowded = $derived(
    new Set(
      nodes
        .filter((node) => getDef(node.data.fn)?.source)
        .slice(MAX_SOURCES)
        .map((node) => node.id),
    ),
  );

  setContext<EditorContext>(EDITOR, {
    get engine() {
      return engine;
    },
    status: (nodeId) => statuses[nodeId],
    crowded: (nodeId) => crowded.has(nodeId),
    attach,
  });

  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  /** Say something in the status line. Without something to do, it goes away by itself. */
  function tell(text: string, action?: Notice["action"]) {
    clearTimeout(noticeTimer);
    notice = { text, action };
    if (!action) noticeTimer = setTimeout(() => (notice = null), 4000);
  }

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
      created = new Engine(canvas, {
        loadMedia,
        onstatus: (nodeId, status) => {
          if (status) statuses[nodeId] = status;
          else delete statuses[nodeId];
        },
      });
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

    nodes = [...others.map(deselected), { ...node, position, selected: true }];
    edges = next.map(toFlowEdge);
  }

  /** Keep a picture or video in this browser; the patch gets its name */
  async function keep(file: File): Promise<MediaRef | undefined> {
    try {
      return await saveMedia(file);
    } catch (error) {
      console.warn("could not keep the file", error);
      tell("this browser wouldn't keep that file");
      return undefined;
    }
  }

  function attach(nodeId: string, file: File) {
    const node = nodes.find((candidate) => candidate.id === nodeId);
    const wanted = node && getDef(node.data.fn)?.source;
    if (!wanted || mediaKind(file) !== wanted) {
      tell(wanted === "video" ? "that isn't a video" : "that isn't a picture");
      return;
    }
    keep(file).then((media) => media && flow.updateNodeData(nodeId, { media }));
  }

  const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;

  function ondragover(event: DragEvent) {
    if (!carriesFiles(event) || !event.dataTransfer) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  // A picture or video dropped on the canvas becomes a node; dropped on a node of its kind, that node's file
  async function ondrop(event: DragEvent) {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    const files = [...(event.dataTransfer?.files ?? [])];
    const over = (event.target as HTMLElement | null)?.closest<HTMLElement>(".svelte-flow__node");
    const target = nodes.find((node) => node.id === over?.dataset.id);
    const at = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    let placed = 0;
    for (const file of files) {
      const kind = mediaKind(file);
      const def = kind && getDef(kind);
      if (!def) {
        tell("only pictures and videos can be dropped here");
      } else if (files.length === 1 && target && getDef(target.data.fn)?.source === kind) {
        attach(target.id, file);
      } else {
        const media = await keep(file);
        if (!media) continue;
        const node = newNode(def, { x: at.x + placed * 32, y: at.y + placed * 32 });
        nodes = [
          ...nodes.map(deselected),
          { ...node, data: { ...node.data, media }, selected: true },
        ];
        placed++;
      }
    }
  }

  async function share() {
    const url = shareUrl(window.location.href, await encodePatch(toSaved(nodes, edges, shown)));
    const files = nodes.some((node) => node.data.media);
    try {
      await navigator.clipboard.writeText(url);
      tell(files ? "link copied · your files stay in this browser" : "link copied");
    } catch {
      // No clipboard here: the address bar can carry it
      window.history.replaceState(null, "", url);
      tell("the link is in the address bar");
    }
  }

  function show(patch: SavedPatch) {
    ({ nodes, edges } = fromSaved(patch));
    shown = patch.shown;
    flow.fitView({ padding: 0.3, maxZoom: 1 });
  }

  const mineKept = () =>
    tell("this patch came from a link · yours is kept", {
      label: "bring mine back",
      run: bringMineBack,
    });

  /** The address carries a patch: show it, and keep the person's own to come back to */
  async function openLink() {
    const encoded = linkedPatch(window.location.hash);
    if (encoded === undefined) return;
    // Back to the plain address, so a reload doesn't open the link over later work
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    const linked = await decodePatch(encoded);
    if (!linked || linked.nodes.length === 0) {
      tell("that link doesn't hold a patch");
      return;
    }
    const mine = snapshot();
    const incoming = fromSaved(linked);
    if (JSON.stringify(toSaved(incoming.nodes, incoming.edges, linked.shown)) === mine) return;
    history.record(mine);
    show(linked);
    if (mine === pristine) {
      tell("opened a patch from a link");
      return;
    }
    try {
      // A second link doesn't replace what was set aside at the first
      if (!localStorage.getItem(MINE_KEY)) localStorage.setItem(MINE_KEY, mine);
    } catch {
      // No storage: undo still goes back to it
    }
    mineKept();
  }

  function bringMineBack() {
    const mine = stored(MINE_KEY);
    if (mine) show(mine);
    forgetMine();
  }

  /** The patch that is open is the one to keep: let go of the one set aside */
  function forgetMine() {
    notice = null;
    try {
      localStorage.removeItem(MINE_KEY);
    } catch {
      // Nothing was kept
    }
  }

  function dismiss() {
    if (notice?.action) forgetMine();
    notice = null;
  }

  onMount(() => {
    pruneMedia(new Set([...mediaOf(initial), ...mediaOf(stored(MINE_KEY))])).catch(() => {});
    if (stored(MINE_KEY)) mineKept();
    openLink();
    window.addEventListener("hashchange", openLink);
    return () => window.removeEventListener("hashchange", openLink);
  });

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

<div class="patch" class:hidden={performing} role="presentation" {ondragover} {ondrop}>
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
    onshare={share}
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
    {notice}
    ondismiss={dismiss}
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
