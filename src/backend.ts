import { buildDisks } from './mockData';
import { hydrateDisk, type BackendDisk, type Disk, type ScanRoot } from './types';

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

function diskFromScanRoot(root: ScanRoot): Disk {
  const letter = root.path.match(/^([A-Za-z]):/)?.[1]?.toUpperCase() ?? (root.name.charAt(0) || '?');
  return {
    letter,
    label: root.name,
    totalBytes: root.totalBytes,
    root: {
      id: 0,
      path: root.path,
      name: root.name,
      kind: 'dir',
      cat: 'other',
      size: 0,
      days: 0,
      count: 0,
      parent: null,
    },
  };
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

export async function loadInitialDisks(): Promise<Disk[]> {
  if (!hasTauriBackend()) return getMockDisks();
  try {
    const roots = await listScanRoots();
    return roots.length === 0 ? getMockDisks() : roots.map(diskFromScanRoot);
  } catch {
    return getMockDisks();
  }
}
