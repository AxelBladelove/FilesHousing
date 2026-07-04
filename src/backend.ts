import { buildDisks } from './mockData';
import {
  hydrateDisk,
  type BackendDisk,
  type CleanupPreviewItem,
  type CleanupPreviewSummary,
  type Disk,
  type ScanRoot,
} from './types';

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

let invokePromise: Promise<InvokeFn> | null = null;
let mockDisks: Disk[] | null = null;

function getMockDisks(): Disk[] {
  mockDisks ??= buildDisks();
  return mockDisks;
}

function mockRoots(): ScanRoot[] {
  return getMockDisks().map(disk => ({
    id: disk.root.path ?? disk.letter,
    name: `${disk.letter}: ${disk.label}`,
    path: disk.root.path ?? `${disk.letter}:\\`,
    totalBytes: disk.totalBytes,
  }));
}

export function hasTauriBackend(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function tauriInvoke(): Promise<InvokeFn | null> {
  if (!hasTauriBackend()) return null;
  invokePromise ??= import('@tauri-apps/api/core').then(mod => mod.invoke as InvokeFn);
  return invokePromise;
}

export async function listScanRoots(): Promise<ScanRoot[]> {
  const invoke = await tauriInvoke();
  if (!invoke) return mockRoots();
  return invoke<ScanRoot[]>('list_scan_roots');
}

export async function scanRoot(path: string): Promise<Disk> {
  const invoke = await tauriInvoke();
  if (!invoke) {
    const disk = getMockDisks().find(candidate =>
      candidate.root.path === path || `${candidate.letter}:\\` === path || candidate.letter === path || `${candidate.letter}:` === path || candidate.label === path,
    );
    return disk ?? getMockDisks()[0];
  }

  const disk = await invoke<BackendDisk>('scan_root', { path });
  return hydrateDisk(disk);
}

export async function openInExplorer(path: string): Promise<void> {
  const invoke = await tauriInvoke();
  if (!invoke) return;
  await invoke('open_path_in_explorer', { path });
}

export async function previewCleanup(items: CleanupPreviewItem[]): Promise<CleanupPreviewSummary> {
  const invoke = await tauriInvoke();
  if (!invoke) {
    return {
      reviewedCount: items.length,
      acceptedCount: items.length,
      skippedCount: 0,
      reclaimableBytes: items.reduce((total, item) => total + item.estimatedBytes, 0),
      skipped: [],
    };
  }
  return invoke<CleanupPreviewSummary>('preview_cleanup', { items });
}

export async function loadInitialDisks(): Promise<Disk[]> {
  if (!hasTauriBackend()) return getMockDisks();
  try {
    const roots = await listScanRoots();
    return roots.length === 0 ? getMockDisks() : [];
  } catch {
    return getMockDisks();
  }
}
