import { invoke } from '@tauri-apps/api/core';
import { buildDisks } from './mockData';
import { hydrateDisk, type BackendDisk, type Disk, type ScanRoot } from './types';

export async function listScanRoots(): Promise<ScanRoot[]> {
  return invoke<ScanRoot[]>('list_scan_roots');
}

export async function scanRoot(path: string): Promise<Disk> {
  const disk = await invoke<BackendDisk>('scan_root', { path });
  return hydrateDisk(disk);
}

export async function openInExplorer(path: string): Promise<void> {
  await invoke('open_path_in_explorer', { path });
}

export function hasTauriBackend(): boolean {
  return Boolean('__TAURI_INTERNALS__' in window);
}

export async function loadInitialDisks(): Promise<Disk[]> {
  if (!hasTauriBackend()) return buildDisks();
  try {
    const roots = await listScanRoots();
    if (roots.length === 0) return buildDisks();
    return Promise.all(roots.map(root => scanRoot(root.path)));
  } catch {
    return buildDisks();
  }
}
