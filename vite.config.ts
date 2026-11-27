import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelte()],
  // hydra-synth's dependencies expect node's `global`
  define: { global: "globalThis" },
  build: {
    // Two pages: the landing page at /, the editor at /app
    rollupOptions: {
      input: { index: "index.html", app: "app.html" },
    },
  },
});
