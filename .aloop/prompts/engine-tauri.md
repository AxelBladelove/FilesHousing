# Task engine-tauri: Tauri desktop shell plus Rust filesystem engine

PERFORMANCE-FIRST DIRECTIVE (non-negotiable):
Every design and implementation decision optimizes runtime performance first.
- Choose the leanest viable approach: standard library before dependency, dependency
  only when it clearly beats hand-rolling on speed AND maintenance.
- Know your hot path: pick data structures and algorithms for the access pattern this
  code will actually have; state the expected complexity in a code comment only when
  a slower-looking choice is deliberate.
- No premature abstraction: layers, generics and indirection must pay for themselves.
- Measure when it matters: if the task touches a hot path, add or run a micro-benchmark
  or timing check and report the numbers in your result block.
- Budgets: fast startup, low allocation churn, minimal I/O round-trips, smallest viable
  bundle/binary. If you must trade performance for anything, say so explicitly in NOTES.

## Context

You are working in a git worktree on branch `task/engine-tauri`. Project: FilesHousing is a Windows-first desktop app for understanding disk usage visually. The UI already exists in TypeScript/Vite and currently uses mock data from `src/mockData.ts`. Your slice: create the native PC engine so the app can run as a Tauri desktop app and scan real disks, then connect the UI to IPC while preserving browser/mock fallback.

Relevant files:
- `fileshousing_brief.md`: product and technical brief.
- `FRONTEND.md`: UI handoff and backend contract.
- `package.json`: Bun/Vite scripts only; do not add npm/yarn lockfiles.
- `src/types.ts`: `Disk` and `FsNode` data contract.
- `src/main.ts`: screen flow, scan animation, queue/open stubs.
- `src/mockData.ts`: fallback only after this task.

Out of scope:
- Do not redesign the visual UI.
- Do not implement AI cleanup decisions.
- Do not permanently delete files; use recycle bin where supported or return a protected error.

## Requirements

1. Add a Tauri 2 Rust app under `src-tauri` with config for Windows desktop usage.
2. Add commands:
   - `list_disks() -> DiskSummary[]`
   - `scan_disk(letter: String) -> Disk`
   - `open_in_explorer(path: String) -> Result<(), String>`
   - `recycle_paths(paths: Vec<String>) -> CleanupResult`
3. The Rust scanner must traverse the selected root, aggregate directories into the `FsNode` shape, sort children by size desc, compute total size, count, most recent age in days, dominant category, and stable ids.
4. Keep the emitted tree bounded enough for the Canvas UI: include top children per directory and aggregate the rest into a `rest` node, while preserving useful top-level zones.
5. Handle permission errors and symlink/reparse loops safely; scanning should continue where possible.
6. Adapt the frontend to call Tauri IPC when available and fall back to mock data in browser/dev preview.
7. Make scan progress UI show real status if practical; otherwise keep a deterministic progress transition around the live scan promise and render the real result when complete.
8. Wire Open in Explorer to the backend command and cleanup queue to a review/recycle backend call.
9. Preserve `bun run build` and add useful Tauri scripts without introducing npm/yarn lockfiles.
10. Commit your work on `task/engine-tauri`.

## Done Criteria

- `bun run build` exits 0.
- `cargo check --manifest-path src-tauri/Cargo.toml` exits 0.
- `package.json` has scripts to run/build the desktop app with Bun.
- Browser preview still works with mock disks.
- Desktop app path uses Tauri commands when available.
- Final answer includes the structured result block below.

## Rules

- Commit your work on this branch with clear messages. Do not touch other branches.
- Run the project's tests/build before finishing; if you cannot make them pass, say so.
- End your FINAL message with exactly this block:
  RESULT: DONE | PARTIAL | BLOCKED
  SUMMARY: <3-6 lines: what was built, key decisions>
  PERF: <perf-relevant choices and any measurements>
  NOTES: <caveats, TODOs, anything the orchestrator must know>
