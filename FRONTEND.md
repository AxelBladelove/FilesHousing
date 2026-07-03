# FilesHousing — frontend handoff

UI-only build of the FilesHousing frontend (see `fileshousing_brief.md`). Runs on mock
data today; designed so the Rust/Tauri backend plugs in without touching the UI.

## Run

```
bun install
bun run dev     # http://localhost:5173
```

The stack is **bun** (package manager + script runner) — do not introduce npm/yarn
lockfiles.

## What's implemented

- **Disk select** → **scan progress** → **storage map** flow.
- Storage map: zoomable "city" treemap (hand-rolled Canvas2D, culling + LOD, world-space
  layout cached per node — pan/zoom is camera-only, no relayout). Districts = folders,
  blocks = files; labels appear per level of detail; small children fold into a
  "+N smaller items" block.
- Interactions: drag pan, wheel zoom-to-cursor, click → details panel, double-click →
  animated fly-to + breadcrumbs, Esc clears.
- Layers: **Type** (category colors) and **Age** (heat: fresh blue → untouched amber).
- Search + filters (min size, last modified, type): non-matching areas dim in place —
  spatial context is never lost.
- Details panel: size, % of disk, file count/age, largest children, actions.
- Cleanup queue: add/remove, reclaimable total, safe-by-default copy (recycle bin
  first). Execution is stubbed pending the backend.

## Backend contract (for the Rust/Tauri implementation)

The entire UI consumes one data shape, `FsNode` in [src/types.ts](src/types.ts):

```ts
{ id, name, kind: 'dir'|'file', cat, size, days, count, children?, parent }
```

`src/mockData.ts` (`buildDisks()`) is the ONLY module that fabricates data. To go live:

1. Expose Tauri commands: `list_disks()` and `scan_disk(letter)` streaming progress
   (files/bytes/current path — the scan screen already renders those fields) and
   returning the aggregated tree (dirs carry summed `size`, `count`, min `days`,
   dominant `cat`; children sorted by size desc).
2. Replace the `buildDisks()` call in `src/main.ts` with the IPC calls. Everything
   else (layout, rendering, filters, queue) works unchanged.
3. Wire the stubbed actions: "Open in Explorer" and queue execution
   (recycle-bin first, always previewed — see Safety Principles in the brief).

Aggregation should happen in Rust (brief: "UI should never depend on raw live
filesystem traversal") — send the UI a pre-aggregated tree, ideally capped to a sane
depth with lazy child fetch for deep zooms.

## Performance notes

- Rendering cost scales with *visible* nodes (~hundreds), not tree size; the layout is
  computed lazily per district and cached forever (world coords are zoom-independent).
- No runtime dependencies; first paint is just Vite + one canvas.
- `bun run build` typechecks and bundles.
