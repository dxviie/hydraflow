<script lang="ts">
  interface Props {
    codeShown: boolean;
    onadd: () => void;
    oncode: () => void;
    onshare: () => void;
    onreset: () => void;
    onperform: () => void;
  }

  let { codeShown, onadd, oncode, onshare, onreset, onperform }: Props = $props();
</script>

<header>
  <div class="brand">hydraflow</div>
  <nav aria-label="Patch">
    <div class="group">
      <button onclick={onadd} title="add a node (Tab)">add node <kbd>tab</kbd></button>
      <button aria-pressed={codeShown} onclick={oncode} title="the patch as hydra code">code</button>
      <button onclick={onshare} title="copy a link that opens this patch">share</button>
      <button onclick={onreset} title="start again from the starter patch">new</button>
    </div>
    <button class="run" onclick={onperform} title="hide the editor (Ctrl/⌘+`)">
      <span class="tri" aria-hidden="true"></span>perform
    </button>
  </nav>
</header>

<style>
  header {
    position: fixed;
    top: 20px;
    left: 24px;
    right: 24px;
    z-index: 20;
    display: flex;
    justify-content: space-between;
    height: var(--top-h);
    font-size: 13px;
    pointer-events: none;
  }

  .brand,
  nav {
    pointer-events: auto;
  }

  .brand {
    display: flex;
    align-items: center;
    padding: 0 14px;
    background: var(--box);
    font: 800 16px / 1 var(--display);
    font-stretch: 112.5%;
  }

  nav,
  .group {
    display: flex;
  }

  nav {
    gap: 8px;
  }

  .group {
    background: var(--box);
  }

  button {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 14px;
  }

  .group button:hover,
  .group button[aria-pressed="true"] {
    background: var(--text);
    color: #000;
  }

  kbd {
    padding: 3px 6px;
    border: 1px solid var(--violet-line);
    color: var(--dim);
    font: inherit;
    font-size: 11px;
  }

  button:hover kbd {
    border-color: currentColor;
    color: inherit;
  }

  .run {
    border: 1px solid var(--run);
    background: var(--run);
    color: #000;
    font-weight: 500;
  }

  .run:hover {
    background: #000;
    color: var(--run);
  }

  .tri {
    width: 8px;
    height: 10px;
    background: currentColor;
    clip-path: polygon(0 0, 100% 50%, 0 100%);
  }
</style>
