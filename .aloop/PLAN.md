# FilesHousing aloop plan

Brief: `fileshousing_brief.md`
Mode: remote
Base branch: `master`

## Milestone 1 - Real backend foundation

- [x] B1 - Scaffold Tauri 2 Rust backend and app contracts
  - Size: M
  - Effort tier: medium
  - Dependencies: none
  - Parallel-ok: false
  - Perf notes: keep startup lean, no unnecessary Rust crates, API returns pre-aggregated data so the UI never traverses the live filesystem.

- [x] B2 - Implement Windows-first disk scanner and aggregation engine
  - Size: L
  - Effort tier: high
  - Dependencies: B1
  - Parallel-ok: false
  - Perf notes: iterative traversal, bounded metadata work, top-N aggregation for visualization, avoid retaining raw per-file detail beyond what the UI needs.
  - Status: merged via PR #2 at `36a111c`; review recorded in `.aloop/reviews/B2.md`.

- [x] B3 - Connect frontend to backend with mock fallback
  - Size: M
  - Effort tier: medium
  - Dependencies: B2
  - Parallel-ok: false
  - Perf notes: one scan request per disk, cached scan result in frontend state, no repeated filesystem calls during canvas interaction.
  - Status: merged via PR #3 at `99bf215`; review recorded in `.aloop/reviews/B3.md`.

- [x] B4 - Implement safe backend actions and Explorer integration
  - Size: M
  - Effort tier: medium
  - Dependencies: B2
  - Parallel-ok: true
  - Perf notes: action queue operates on explicit paths only, preview estimates size from indexed nodes, destructive operations remain confirmable/reviewable.
  - Status: merged via PR #4 at `59c530f`; review recorded in `.aloop/reviews/B4.md`.

## Milestone 2 - Verification and remote integration

- [x] V1 - Build, smoke test, and remote PR integration
  - Size: M
  - Effort tier: medium
  - Dependencies: B3, B4
  - Parallel-ok: false
  - Perf notes: verify Rust build, frontend build, and local app startup without adding long-running scan work to app boot.
  - Status: complete; final checks and browser smoke passed on `master` at `828c1db`.

## Milestone 3 - Backend semantic actionability layer

- [ ] B5 - Add scanner actionability metadata and safe action validation
  - Size: L
  - Effort tier: high
  - Dependencies: B2, B4
  - Parallel-ok: false
  - Perf notes: classify nodes exactly once during existing traversal, propagate cheap semantic context through recursion, use child-name hints already collected by `read_dir`, and avoid heavyweight dependencies or extra filesystem passes.
  - Status: launched in Codex worktree thread on 2026-07-05.

- [ ] V2 - Verify semantic actionability integration
  - Size: S
  - Effort tier: low
  - Dependencies: B5
  - Parallel-ok: false
  - Perf notes: run focused Rust tests first, then `cargo test`/`bun run build`; preserve the known Windows GNU/Tauri test-launch caveat if it still reproduces.
  - Status: pending B5.
