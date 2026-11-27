<script lang="ts">
  import type { Shown } from "../graph/types";

  interface Props {
    paused: boolean;
    nodes: number;
    /** The output playing behind the editor, or all four */
    shown: Shown;
    /** The outputs something is wired to */
    wired: number[];
    fps: number;
    /** Something to tell the person, with at most one thing to do about it */
    notice: { text: string; action?: { label: string; run: () => void } } | null;
    ondismiss: () => void;
    width: number;
    height: number;
    onpause: () => void;
    onshow: (shown: Shown) => void;
  }

  let {
    paused,
    nodes,
    shown,
    wired,
    fps,
    notice,
    ondismiss,
    width,
    height,
    onpause,
    onshow,
  }: Props = $props();

  const buffers = [0, 1, 2, 3];
</script>

<footer>
  <button
    class="mode"
    class:paused
    aria-pressed={paused}
    title={paused ? "let time run again" : "freeze time"}
    onclick={onpause}>{paused ? "paused" : "live"}</button
  >
  <span>{nodes} {nodes === 1 ? "node" : "nodes"}</span>
  <div class="buffers" role="group" aria-label="The output that plays behind the editor">
    <span>showing</span>
    {#each buffers as buffer (buffer)}
      <button
        aria-pressed={shown === buffer}
        class:wired={wired.includes(buffer)}
        onclick={() => onshow(buffer)}>o{buffer}</button
      >
    {/each}
    <button
      aria-pressed={shown === "all"}
      class:wired={wired.length > 0}
      title="the four outputs at once, a quarter each: hydra's render()"
      onclick={() => onshow("all")}>all</button
    >
  </div>
  {#if notice}
    <div class="notice" role="status">
      <span>{notice.text}</span>
      {#if notice.action}
        <button class="act" onclick={notice.action.run}>{notice.action.label}</button>
      {/if}
      <button class="close" aria-label="Dismiss" onclick={ondismiss}>×</button>
    </div>
  {/if}
  <span class="spacer"></span>
  <span>{width}×{height}</span>
  <span class="fps">{fps} fps</span>
</footer>

<style>
  footer {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 16px;
    height: var(--status-h);
    padding: 0 24px;
    border-top: 1px solid var(--rule);
    background: var(--glass);
    color: var(--dim);
    white-space: nowrap;
  }

  .mode {
    align-self: stretch;
    min-width: 74px;
    padding: 0 12px;
    background: var(--run);
    color: #000;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .mode.paused {
    background: #4f4e4a;
    color: var(--text);
  }

  .buffers {
    display: flex;
    align-items: center;
    align-self: stretch;
    gap: 2px;
  }

  .buffers span {
    margin-right: 6px;
  }

  .buffers button {
    height: 20px;
    padding: 0 6px;
    color: var(--dim);
  }

  .buffers button.wired {
    color: var(--text);
  }

  .buffers button:hover {
    color: var(--text);
  }

  .buffers button[aria-pressed="true"] {
    background: var(--text);
    color: #000;
    font-weight: 500;
  }

  .notice {
    display: flex;
    align-items: center;
    align-self: stretch;
    gap: 10px;
    overflow: hidden;
    padding: 0 4px 0 12px;
    background: #000;
    color: var(--text);
  }

  .notice span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .act {
    height: 20px;
    padding: 0 8px;
    border: 1px solid var(--run);
    color: var(--run);
  }

  .act:hover {
    background: var(--run);
    color: #000;
  }

  .close {
    width: 20px;
    height: 20px;
    color: var(--dim);
    font-size: 14px;
  }

  .close:hover {
    color: var(--text);
  }

  .spacer {
    flex: 1;
  }

  .fps {
    min-width: 6ch;
    text-align: right;
  }
</style>
