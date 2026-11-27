<script lang="ts">
  interface Props {
    paused: boolean;
    nodes: number;
    /** The output playing behind the editor */
    shown: number;
    /** The outputs something is wired to */
    wired: number[];
    fps: number;
    width: number;
    height: number;
    onpause: () => void;
    onshow: (buffer: number) => void;
  }

  let { paused, nodes, shown, wired, fps, width, height, onpause, onshow }: Props = $props();

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
  </div>
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

  .spacer {
    flex: 1;
  }

  .fps {
    min-width: 6ch;
    text-align: right;
  }
</style>
