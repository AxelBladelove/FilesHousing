import type { Cat, Disk, Filters, FsNode } from './types';

export type Screen = 'disks' | 'scan' | 'map';
export type Layer = 'type' | 'age';

export interface QueueItem { node: FsNode; }

interface AppState {
  screen: Screen;
  disk: Disk | null;
  layer: Layer;
  query: string;
  filters: Filters;
  selection: FsNode | null;
  focus: FsNode | null; // folder the camera is framing (breadcrumb)
  queue: QueueItem[];
}

export const state: AppState = {
  screen: 'disks',
  disk: null,
  layer: 'type',
  query: '',
  filters: { minSize: 0, minAgeDays: 0, cats: new Set<Cat>() },
  selection: null,
  focus: null,
  queue: [],
};

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): void { listeners.add(fn); }
export function emit(): void { for (const fn of listeners) fn(); }

export function filtersActive(): boolean {
  const f = state.filters;
  return f.minSize > 0 || f.minAgeDays > 0 || f.cats.size > 0 || state.query.trim() !== '';
}

let visGen = 0;

/** Recompute per-node visibility for the active filters + search (one tree pass). */
export function recomputeVisibility(): void {
  visGen++;
  if (!state.disk) return;
  if (!filtersActive()) return; // renderer treats missing gen as fully visible
  const f = state.filters;
  const q = state.query.trim().toLowerCase();

  const walk = (n: FsNode, ancestorMatch: boolean): boolean => {
    const nameMatch = q !== '' && n.name.toLowerCase().includes(q);
    const searchOk = q === '' || nameMatch || ancestorMatch;
    let vis: boolean;
    if (n.children && n.children.length) {
      // a folder is visible if any descendant survives the pass
      let any = false;
      for (const c of n.children) if (walk(c, ancestorMatch || nameMatch)) any = true;
      vis = any;
    } else {
      const sizeOk = n.size >= f.minSize;
      const ageOk = n.days >= f.minAgeDays;
      const catOk = f.cats.size === 0 || f.cats.has(n.cat);
      vis = sizeOk && ageOk && catOk && searchOk;
    }
    n.visGen = visGen; n.vis = vis;
    return vis;
  };
  walk(state.disk.root, false);
}

export function isVisible(n: FsNode): boolean {
  if (!filtersActive()) return true;
  if (n.kind === 'rest') return n.parent ? isVisible(n.parent) && state.query === '' && state.filters.minSize === 0 : false;
  return n.visGen === visGen ? n.vis === true : false;
}

export function queueTotal(): number {
  return state.queue.reduce((a, q) => a + q.node.size, 0);
}

export function inQueue(n: FsNode): boolean {
  return state.queue.some(q => q.node === n);
}

export function toggleQueue(n: FsNode): void {
  const i = state.queue.findIndex(q => q.node === n);
  if (i >= 0) state.queue.splice(i, 1);
  else state.queue.push({ node: n });
  emit();
}
