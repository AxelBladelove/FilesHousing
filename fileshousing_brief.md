# FilesHousing Brief

## Vision

FilesHousing is a Windows-first desktop app for understanding disk usage in a simple, fast, and highly visual way.

The user flow should be extremely direct:

1. Open FilesHousing.
2. Choose a disk.
3. See what is occupying space.
4. Understand where it is.
5. Decide what to inspect, move, archive, or delete.

The product should not feel like a traditional disk analyzer. Its main differentiation must be its disruptive, modern, visual UI.

## Core Problem

After years of use, a computer accumulates thousands of files, folders, downloads, projects, caches, installers, media, and forgotten data.

Windows storage tools are too abstract and category-based. Traditional third-party tools are usually powerful but visually outdated, technical, and unpleasant to use.

FilesHousing should make storage feel understandable at a glance.

## Product Philosophy

- Performance First.
- Visual First.
- Simple and to the point.
- Windows-first.
- No unnecessary complexity.
- No ugly folder-tree-first experience.
- Safe actions by default.
- The UI is the product's biggest differentiator.

## MVP Goal

The first version should do one thing extremely well:

> Let the user choose a disk and instantly understand what is taking space and where it is located.

## Recommended Stack

### Primary Recommendation

- **Core / backend:** Rust
- **Desktop shell:** Tauri 2
- **Frontend:** TypeScript
- **Visual layer:** PixiJS, WebGL/WebGPU, or a similar canvas-based rendering system
- **Target platform:** Windows first

### Reasoning

Rust should handle the performance-critical parts: disk scanning, indexing, metadata processing, file aggregation, and Windows filesystem APIs.

Tauri allows the app to stay lightweight while using a web-based frontend for fast visual iteration.

The frontend should not be a normal HTML dashboard. The visual layer should behave more like an interactive map, canvas, or game-like interface.

## Alternative Stack

If the visual layer eventually needs to feel more native, more engine-like, or more deeply integrated with GPU rendering, consider:

- C++ + Qt Quick / QML
- Rust core + native rendering layer
- Rust + WGPU for a fully custom renderer

However, for the first serious prototype, Tauri + Rust is the most practical direction.

## Core Experience

FilesHousing should not start with a complex dashboard.

The initial experience should be:

- Disk selection screen.
- Scan progress with useful visual feedback.
- Main storage map.
- Click or zoom into large areas.
- See what folder, file type, or project is responsible.
- Filter by size, age, type, or location.
- Queue safe actions.

## Main Interface Concept

The main view should be a visual map of the disk.

Possible metaphors:

- A city map of storage.
- Districts for folders.
- Buildings or blocks for large files.
- Heat zones for old, heavy, or duplicated content.
- Layers for file type, age, and activity.
- Smooth zoom from global disk view to local folder detail.

The user should visually feel:

> "Now I understand where my storage went."

## UI Direction

Do not imitate:

- WinDirStat
- TreeSize
- SpaceSniffer
- Old Windows utility UIs
- Plain folder trees as the main experience

Take inspiration from outside disk analyzers:

- Linear for clarity, polish, and speed.
- Raycast for command-driven actions.
- FigJam for spatial canvas navigation.
- Obsidian Graph for global/local exploration.
- Video game maps for visual hierarchy and spatial discovery.
- Modern sci-fi dashboards for atmosphere, but without sacrificing usability.

## Visual Principles

- Dark, premium, modern interface.
- Strong contrast.
- Smooth animations.
- Spatial navigation.
- Clear visual hierarchy.
- Minimal panels.
- No clutter.
- No technical overload.
- Large space usage should be obvious immediately.
- The app should feel more like exploring a storage world than reading a file table.

## Core Features for V1

- Select disk.
- Scan selected disk.
- Show total used/free space.
- Show biggest storage zones visually.
- Zoom into folders/clusters.
- Show top space consumers.
- Filter by:
  - file size
  - file type
  - age
  - folder
  - extension
- Search by name/path/type.
- Show file/folder details on click.
- Safe action queue for future cleanup operations.

## Safety Principles

FilesHousing should not aggressively delete files.

For V1, destructive actions should be limited or protected:

- Preview before action.
- Confirm before deleting.
- Prefer "send to recycle bin" over permanent delete.
- Show estimated space recovery.
- Keep actions reviewable before execution.

## Technical Direction

The app should separate scanning from visualization.

Recommended architecture:

- Disk scanner in Rust.
- Local metadata index.
- Aggregation engine for folders/clusters.
- Frontend receives processed visual data.
- UI should never depend on raw live filesystem traversal for normal interaction.
- Background workers should keep the UI responsive.
- Future versions can add incremental updates using Windows filesystem change tracking.

## Non-Goals for V1

- No cloud sync.
- No cross-platform support at first.
- No full file manager replacement.
- No complex automation.
- No AI cleanup decisions without user review.
- No 3D gimmicks unless they improve clarity.
- No copying traditional treemap tools as the main visual identity.

## Success Criteria

FilesHousing succeeds if a user can open the app, choose a disk, and understand the biggest storage problems in under one minute.

The app should feel simple, fast, visual, and new.

The final product should make the user think:

> "This is what Windows storage management should have looked like."
