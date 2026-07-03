import type { FsNode, Rect } from './types';

/**
 * Squarified treemap layout with proportional world-space padding, so the
 * "streets between districts" look identical at every zoom depth.
 * Rects are cached on the node — layout runs once per node, lazily.
 */

const MAX_MAP_CHILDREN = 34;
const MIN_SHARE = 0.0035; // children below 0.35% of parent fold into the rest node

let restId = -1;

/** Children drawn on the map: top-N plus one aggregated 'rest' block. */
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

/** Lay out (and cache) the map children of `node` inside its world rect. */
export function layoutChildren(node: FsNode, rect: Rect): FsNode[] {
  const kids = mapChildren(node);
  if (kids.length === 0) return kids;
  if (kids[0].rect) return kids; // already laid out (rects are world-stable)

  const pad = Math.min(rect.w, rect.h) * 0.035;
  const band = pad * 2.6; // top strip reserved for the district label
  const inner: Rect = {
    x: rect.x + pad, y: rect.y + band,
    w: Math.max(1e-6, rect.w - pad * 2),
    h: Math.max(1e-6, rect.h - band - pad),
  };
  const rects = squarify(kids.map(k => k.size), inner);
  const gap = Math.min(inner.w, inner.h) * 0.012;
  for (let i = 0; i < kids.length; i++) {
    const r = rects[i];
    const gx = Math.min(gap, r.w * 0.18), gy = Math.min(gap, r.h * 0.18);
    kids[i].rect = { x: r.x + gx / 2, y: r.y + gy / 2, w: r.w - gx, h: r.h - gy };
  }
  return kids;
}

/** Classic squarified treemap. `areas` must be sorted descending. */
function squarify(areas: number[], rect: Rect): Rect[] {
  const total = areas.reduce((a, b) => a + b, 0) || 1;
  const scale = (rect.w * rect.h) / total;
  const scaled = areas.map(a => Math.max(a * scale, 1e-9));

  const out: Rect[] = new Array(areas.length);
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
    const horiz = w < h; // lay the row along the shorter side
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
