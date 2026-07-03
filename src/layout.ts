import type { FsNode } from './types';

/**
 * Ground-plan layout for the city: squarified treemap in world coordinates,
 * with proportional gaps as streets. Computed lazily per district, cached
 * forever (world coords are zoom-independent).
 */

export interface Plan { x: number; y: number; w: number; h: number; }

export const WORLD = 1100; // root city plan is WORLD x WORLD

const MAX_MAP_CHILDREN = 26;
const MIN_SHARE = 0.005; // children below 0.5% of parent fold into the rest pad

let restId = -1;

/** Children shown on the map: top-N plus one aggregated 'rest' node. */
export function mapChildren(node: FsNode): FsNode[] {
  if (node.mapChildren) return node.mapChildren;
  const kids = node.children ?? [];
  const shown: FsNode[] = [];
  let restSize = 0, restCount = 0;
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i];
    if (i < MAX_MAP_CHILDREN && c.size >= node.size * MIN_SHARE) shown.push(c);
    else { restSize += c.size; restCount += c.count; }
  }
  if (restSize > 0) {
    shown.push({
      id: restId--, name: `${restCount.toLocaleString()} smaller items`,
      kind: 'rest', cat: 'other', size: restSize, days: node.days,
      count: restCount, parent: node,
    });
  }
  node.mapChildren = shown;
  return shown;
}

/** Lay out (and cache) the map children of `node` inside its plan rect. */
export function layoutChildren(node: FsNode): FsNode[] {
  const kids = mapChildren(node);
  if (kids.length === 0) return kids;
  if (kids[0].plan) return kids;

  const rect = node.plan!;
  const street = Math.min(rect.w, rect.h) * 0.045;
  const inner: Plan = {
    x: rect.x + street, y: rect.y + street,
    w: Math.max(1e-6, rect.w - street * 2),
    h: Math.max(1e-6, rect.h - street * 2),
  };
  const rects = squarify(kids.map(k => k.size), inner);
  const gap = Math.min(inner.w, inner.h) * 0.024;
  for (let i = 0; i < kids.length; i++) {
    const r = rects[i];
    const gx = Math.min(gap, r.w * 0.22), gy = Math.min(gap, r.h * 0.22);
    kids[i].plan = { x: r.x + gx / 2, y: r.y + gy / 2, w: r.w - gx, h: r.h - gy };
  }
  return kids;
}

/** Building height in world units: log-scaled so towers stay legible. */
export function buildingHeight(n: FsNode): number {
  const MB = 1024 ** 2;
  const h = 9 + Math.max(0, Math.log2(n.size / (25 * MB))) * 8.5;
  return Math.min(118, h);
}

/** Classic squarified treemap. `areas` assumed sorted descending. */
function squarify(areas: number[], rect: Plan): Plan[] {
  const total = areas.reduce((a, b) => a + b, 0) || 1;
  const scale = (rect.w * rect.h) / total;
  const scaled = areas.map(a => Math.max(a * scale, 1e-9));

  const out: Plan[] = new Array(areas.length);
  let x = rect.x, y = rect.y, w = rect.w, h = rect.h;
  let row: number[] = [], rowIdx: number[] = [], i = 0;

  const worst = (row: number[], side: number): number => {
    const s = row.reduce((a, b) => a + b, 0);
    const mx = Math.max(...row), mn = Math.min(...row);
    const s2 = s * s, side2 = side * side;
    return Math.max((side2 * mx) / s2, s2 / (side2 * mn));
  };

  const layoutRow = () => {
    const s = row.reduce((a, b) => a + b, 0);
    const horiz = w < h;
    const side = horiz ? w : h;
    const thick = s / side;
    let off = 0;
    for (let j = 0; j < row.length; j++) {
      const len = row[j] / thick;
      out[rowIdx[j]] = horiz
        ? { x: x + off, y, w: len, h: thick }
        : { x, y: y + off, w: thick, h: len };
      off += len;
    }
    if (horiz) { y += thick; h -= thick; } else { x += thick; w -= thick; }
    row = []; rowIdx = [];
  };

  while (i < scaled.length) {
    const side = Math.min(w, h);
    if (row.length === 0 || worst([...row, scaled[i]], side) <= worst(row, side)) {
      row.push(scaled[i]); rowIdx.push(i); i++;
    } else {
      layoutRow();
    }
  }
  if (row.length) layoutRow();
  return out;
}
