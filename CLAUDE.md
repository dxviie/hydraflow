# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
hydraflow is a browser-based, node-based editor for the hydra video synth (`hydra-synth`), built with Svelte 5 and Svelte Flow (`@xyflow/svelte`), bundled by Vite, with Bun for installing, scripts and tests. It is a sibling of HYDRACTRL (github.com/dxviie/HYDRACTRL) and shares its look: the HYDRACTRL site's tokens and fonts (`src/app.css`), square corners, text and nodes in near-black boxes over the visuals, violet for selection, green for run.

The whole app is one page (`index.html`, `src/main.ts`, `src/App.svelte`). The output plays fullscreen behind the patch; nodes follow "direction A" of the design session: a node shows its main parameters at rest, everything when selected, and one line of code when folded; the live preview is a per-node toggle.

- `src/lib/graph/` is the patch, with no browser or Svelte in it, and is where logic belongs when it can live there: `types.ts`, `compile.ts` (patch to expressions, to hydra code with `toCode`, to hydra chain objects with `buildChain`; `signature` is everything that needs new shaders), `params.ts` (what a driven parameter is worth, and the same thing as hydra code: a test keeps the two equal, against hydra's own array sequencing), `edit.ts` (wiring changes), `storage.ts` (the saved format, parsed piece by piece, and the starter patch), `history.ts` (undo).
- `src/lib/hydra/catalog.ts` builds the node catalog from hydra's own `glsl-functions.js` and adds ranges, primary parameter counts and descriptions; a test fails when hydra ships a texture function the catalog has no node for. `engine.ts` owns the hydra instance, the render loop, the inputs, lazy audio and the per-node previews (drawn with hydra's regl into one small framebuffer, read back a few times a second; the rows come back in the order hydra shows them on screen, so the preview canvas is not flipped). `inputs.ts` opens a camera, a screen, a picture or a video as an element hydra reads.
- Input nodes (`cam`, `screen`, `image`, `video`: a `source` in the catalog) take hydra's inputs s0 to s3 in patch order; a fifth gets none. The engine keeps what each one holds open by node (`Engine.held`), not by input, so a camera or a shared screen survives the inputs shifting. A screen is only shared from a click (`Engine.startScreen`). Pictures and videos live in IndexedDB (`src/lib/media.ts`); the patch holds their id and name only, and files no saved patch names are pruned at start-up.
- `src/lib/share.ts` packs a saved patch into the address's `#patch=…` (deflated, base64url, size-capped both ways) and reads one back through `parsePatch`. Opening a link sets the person's own patch aside under `hydraflow.patch.mine` and offers it back in the status line; never replace their patch without that.
- `src/lib/flow.ts` converts between the patch and Svelte Flow's nodes and edges, which are the patch while the editor is open. A saved patch must save back as the same string (a test checks it): undo relies on that.
- `src/lib/ui/` holds the components: `Editor.svelte` (the shell: Svelte Flow, palette requests, connect and delete rules, undo, autosave, dropped files, links, notices, keys; nodes reach it through the `EDITOR` context), `HydraNode.svelte` (the one node type for every catalog entry), `SourceRows.svelte` (what an input node shows: its file, its screen, what went wrong), `ParamRow.svelte`, `DrivePanel.svelte`, `NumberField.svelte`, `Palette.svelte`, `TopBar.svelte`, `StatusBar.svelte` (which also carries notices), `CodePane.svelte`, and `scrub.ts` (drag sideways to change a number).

Rules that hold the design together:
- Parameters reach hydra as functions it calls every frame (`Engine.chainOf`), so a value change never recompiles a shader. Only a change of `signature` calls `Engine.apply`.
- A patch is data: nothing in it is evaluated as code, and it never makes the browser fetch anything (files are the person's own, named, not linked). Keep it that way (no `eval`, no `new Function` outside tests, no URLs in a patch), so opening someone else's patch stays safe.
- An input holds one wire; a wire that would close a loop is refused (feedback goes through a `src` node); deleting a node closes the gap in its chain.
- Svelte Flow: use only what the MIT package exports. Never set `proOptions.hideAttribution`, and never copy code from Svelte Flow's Pro examples.
- Drags go through pointer events (`scrub.ts`), never mouse events, so touch works.

## Build Commands
- Setup: `bun install`
- Start dev: `bun dev`
- Build: `bun run build` (static site into `dist/`)
- Preview the build: `bun run preview`
- Lint: `bun run lint` (Biome, `src/`)
- Format: `bun run format`
- Type-check: `bun run check` (svelte-check; it needs TypeScript 6, not 7)
- Test all: `bun test`
- Test single: `bun test src/path/to/file.test.ts` or `bun test -t "test description"`

## Code Style Guidelines
- **Formatting**: Follow the Biome config (2-space indent, 100 char line length); Svelte script blocks stay indented
- **Svelte**: Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`); nodes and edges are `$state.raw` arrays bound to `<SvelteFlow>`, replaced rather than mutated
- **Types**: TypeScript with strict mode; avoid `any` (hydra's untyped chain objects are the one exception, as `Chain`)
- **Naming**: camelCase for variables/functions, PascalCase for classes and components
- **Tests**: `bun test`, next to the code as `*.test.ts`; test names say what the code does for the person using it
- **Performance**: this is a live visuals tool. Nothing on the per-frame path should allocate or recompile needlessly
- **UI copy**: lowercase, short, in the voice of the HYDRACTRL site (`// comments` for descriptions)
