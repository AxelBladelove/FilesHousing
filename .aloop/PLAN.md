# FilesHousing aloop Plan

Brief: `fileshousing_brief.md`
Mode: local

## Milestone 1 - Native PC Engine

- [ ] `engine-tauri`: Tauri desktop shell plus Rust filesystem engine
  - Size: L
  - Effort: xhigh
  - Deps: none
  - parallel-ok: false
  - Performance notes: Scanner must aggregate in Rust, keep UI off raw traversal, avoid extra I/O passes, cap emitted children for interactive rendering.

- [ ] `ui-ipc`: UI adapter from mock data to live IPC, with browser fallback
  - Size: M
  - Effort: medium
  - Deps: `engine-tauri`
  - parallel-ok: false
  - Performance notes: Preserve cached Canvas layout and pass pre-aggregated `FsNode` trees only.

- [ ] `safe-actions`: Wire Open in Explorer and cleanup queue review/recycle commands
  - Size: M
  - Effort: medium
  - Deps: `engine-tauri`, `ui-ipc`
  - parallel-ok: false
  - Performance notes: Avoid deleting in the UI process; batch action payloads and fail per path.

- [ ] `verify-package`: Build verification and local run instructions
  - Size: S
  - Effort: low
  - Deps: `engine-tauri`, `ui-ipc`, `safe-actions`
  - parallel-ok: true
  - Performance notes: Use existing Bun/Vite pipeline; do not introduce npm/yarn lockfiles.

