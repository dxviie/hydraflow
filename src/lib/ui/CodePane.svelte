<script lang="ts">
  interface Props {
    code: string;
  }

  let { code }: Props = $props();

  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const lines = $derived(code.split("\n"));

  /** Numbers in the site's violet; the rest stays plain */
  function tokens(line: string): { text: string; number: boolean }[] {
    return line
      .split(/(?<![\w.])(-?\d+(?:\.\d+)?)(?!\w)/)
      .map((text, index) => ({ text, number: index % 2 === 1 }))
      .filter((token) => token.text !== "");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
      clearTimeout(timer);
      timer = setTimeout(() => (copied = false), 1500);
    } catch {
      copied = false;
    }
  }
</script>

<section aria-label="The patch as hydra code">
  <div class="head">
    <span class="file">patch.js</span>
    <span>read only</span>
    <button onclick={copy}>{copied ? "copied" : "copy"}</button>
  </div>
  <pre>{#each lines as line, index (index)}<span class="hl"
        >{#each tokens(line) as token, at (at)}{#if token.number}<span class="num">{token.text}</span
            >{:else}{token.text}{/if}{/each}</span
      >{"\n"}{/each}</pre>
</section>

<style>
  section {
    position: fixed;
    left: 24px;
    bottom: calc(var(--status-h) + 20px);
    z-index: 15;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    max-width: min(640px, calc(100vw - 180px));
    max-height: 50vh;
    font-size: 13px;
    pointer-events: none;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 16px;
    height: 28px;
    padding: 0 4px 0 10px;
    background: var(--box);
    color: var(--dim);
    pointer-events: auto;
  }

  .file {
    color: var(--text);
  }

  button {
    height: 20px;
    padding: 0 8px;
    border: 1px solid var(--violet-edge);
    font-size: 12px;
  }

  button:hover {
    border-color: var(--text);
    background: var(--text);
    color: #000;
  }

  pre {
    max-width: 100%;
    margin: 0;
    padding: 0 6px;
    overflow: auto;
    font: inherit;
    line-height: 22px;
    pointer-events: auto;
    user-select: text;
    -webkit-user-select: text;
    scrollbar-width: none;
  }

  /* Code set on the visuals the way hydra's editor sets it: a dark box behind each line */
  .hl {
    background: var(--box);
    box-shadow:
      6px 0 0 var(--box),
      -6px 0 0 var(--box);
  }

  .num {
    color: var(--num);
  }
</style>
