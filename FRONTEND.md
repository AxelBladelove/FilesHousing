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

- **Disk select** (cards with live mini-skylines of each disk's real data) →
  **scan-as-construction** (the city physically builds while the counter runs) →
  **the storage city**.
- The city: a night-time isometric metropolis, hand-rolled Canvas2D. Districts =
  folder plates, towers = files (height = log size), streets = treemap gaps. Cast
  shadows, edge fog, ground grid, street-sign district labels, painter-sorted boxes,
  silhouette-accurate hit-testing (towers included). Culling + LOD: per-frame cost
  tracks visible nodes, not tree size; redraws only on change.
- Interactions: drag pan, wheel zoom-to-cursor, hover → giant kinetic readout,
  click → details panel + light beam on the selection, double-click → camera fly-to
  with breadcrumbs, minimap (click to jump), Esc clears.
- **Ctrl+K command palette** (Raycast-style, per the brief): search files/folders and
  jump to them; quick actions (layer toggle, filters). While typing, non-matching
  buildings power down to dark slabs — matches stay lit.
- Layers: **Type** (category colors) and **Age** (heat: fresh blue → untouched amber),
  reflected in the minimap.
- Filters (min size, last modified, type): the city goes dark where the filter says
  no — spatial context is never lost.
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
