<script lang="ts">
  import { SvelteFlowProvider } from "@xyflow/svelte";

  import Editor from "./lib/ui/Editor.svelte";
</script>

<SvelteFlowProvider>
  <Editor />
</SvelteFlowProvider>
