/** File type categories used for coloring and filtering. */
export type Cat =
  | 'video' | 'image' | 'audio' | 'doc' | 'code'
  | 'archive' | 'app' | 'game' | 'system' | 'data' | 'other';

export interface FsNode {
  id: number;
  name: string;
  kind: 'dir' | 'file' | 'rest';
  cat: Cat;
  /** bytes */
  size: number;
  /** days since last modification (dirs: most recent descendant) */
  days: number;
  /** total file count (files: 1) */
  count: number;
  parent: FsNode | null;
  children?: FsNode[];
  /** children shown on the map: top-N by size plus an aggregated 'rest' node */
  mapChildren?: FsNode[];
  /** world-space rect, cached once computed (stable across zooms) */
  rect?: Rect;
  /** visibility generation + result for the active filter/search pass */
  visGen?: number;
  vis?: boolean;
}

export interface Rect { x: number; y: number; w: number; h: number; }

export interface Disk {
  letter: string;
  label: string;
  totalBytes: number;
  root: FsNode; // used bytes = root.size
}

export interface Filters {
  minSize: number;       // bytes, 0 = all
  minAgeDays: number;    // 0 = any
  cats: Set<Cat>;        // empty = all
}

export const CAT_COLOR: Record<Cat, string> = {
  video:   '#fb7185',
  image:   '#fbbf24',
  audio:   '#f472b6',
  doc:     '#60a5fa',
  code:    '#2dd4bf',
  archive: '#a3e635',
  app:     '#a78bfa',
  game:    '#e879f9',
  system:  '#64748b',
  data:    '#34d399',
  other:   '#94a3b8',
};

export const CAT_LABEL: Record<Cat, string> = {
  video: 'Video', image: 'Images', audio: 'Audio', doc: 'Documents',
  code: 'Code', archive: 'Archives', app: 'Apps', game: 'Games',
  system: 'System', data: 'Data', other: 'Other',
};

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const KB = 1024;

export function fmtBytes(n: number): string {
  if (n >= 100 * GB) return (n / GB).toFixed(0) + ' GB';
  if (n >= GB) return (n / GB).toFixed(1) + ' GB';
  if (n >= 100 * MB) return (n / MB).toFixed(0) + ' MB';
  if (n >= MB) return (n / MB).toFixed(1) + ' MB';
  if (n >= KB) return (n / KB).toFixed(0) + ' KB';
  return n + ' B';
}

export function fmtAge(days: number): string {
  if (days < 1) return 'today';
  if (days < 30) return `${Math.round(days)}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}

export function nodePath(n: FsNode): string {
  const parts: string[] = [];
  let cur: FsNode | null = n;
  while (cur) { parts.unshift(cur.name); cur = cur.parent; }
  return parts.join('\\');
}
