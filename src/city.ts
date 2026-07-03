import { buildingHeight, layoutChildren, WORLD } from './layout';
import { isVisible, state } from './state';
import { CAT_COLOR, fmtBytes, type FsNode } from './types';

/**
 * The storage city: a night-time isometric metropolis rendered with Canvas2D.
 * Districts are folder plates, towers are files (height = log size), streets
 * are treemap gaps. Painter-sorted boxes, cast shadows, edge fog, and a
 * frame-accurate silhouette hit-test. Redraws only when something changes.
 */

const OPEN_W = 330;       // screen diamond width before a district opens
const PLATE_H = 3;        // district plate thickness (world units)
const HEADROOM = 84;      // vertical fit margin for towers when framing

interface Camera { cx: number; cy: number; k: number; }
interface CamAnim { f: Camera; t: Camera; t0: number; dur: number; }
interface Label { text: string; sub: string; x: number; y: number; big: boolean; }
interface Hit { n: FsNode; poly: number[]; }

export interface CityEvents {
  onSelect(node: FsNode | null): void;
  onFocus(node: FsNode): void;
  onHover(node: FsNode | null): void;
}

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- color

const colorCache = new Map<string, [number, number, number]>();

function rgbOf(key: string, css: string): [number, number, number] {
  let c = colorCache.get(key);
  if (c) return c;
  if (css.startsWith('#')) {
    const v = parseInt(css.slice(1), 16);
    c = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  } else {
    const m = css.match(/hsl\((\d+\.?\d*) (\d+\.?\d*)% (\d+\.?\d*)%\)/)!;
    c = hslToRgb(+m[1], +m[2] / 100, +m[3] / 100);
  }
  colorCache.set(key, c);
  return c;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

function shade(c: [number, number, number], lum: number, toward = 0): string {
  // lum < 1 darkens toward black; `toward` mixes toward white first
  const r = c[0] + (255 - c[0]) * toward, g = c[1] + (255 - c[1]) * toward, b = c[2] + (255 - c[2]) * toward;
  return `rgb(${Math.round(r * lum)},${Math.round(g * lum)},${Math.round(b * lum)})`;
}

// ---------------------------------------------------------------- class

export class CityRenderer {
  private ctx: CanvasRenderingContext2D;
  private cam: Camera = { cx: WORLD / 2, cy: WORLD / 2, k: 1 };
  private anim: CamAnim | null = null;
  private cw = 0; private ch = 0; private dpr = 1;
  private hover: FsNode | null = null;
  private dirty = true;
  private raf = 0;
  private root: FsNode | null = null;
  private build = 1;      // city construction progress 0..1
  private labels: Label[] = [];
  private hits: Hit[] = [];
  private mini: HTMLCanvasElement | null = null;

  constructor(private canvas: HTMLCanvasElement, private events: CityEvents) {
    this.ctx = canvas.getContext('2d')!;
    this.bind();
    this.resize();
    const loop = () => { this.raf = requestAnimationFrame(loop); this.tick(); };
    this.raf = requestAnimationFrame(loop);
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement!);
  }

  destroy(): void { cancelAnimationFrame(this.raf); }

  attachMinimap(mini: HTMLCanvasElement): void {
    this.mini = mini;
    mini.addEventListener('pointerdown', e => {
      const r = mini.getBoundingClientRect();
      const wx = ((e.clientX - r.left) / r.width) * WORLD;
      const wy = ((e.clientY - r.top) / r.height) * WORLD;
      this.animateTo({ cx: wx, cy: wy, k: this.cam.k }, 420);
    });
  }

  setRoot(root: FsNode, withBuild: boolean): void {
    this.root = root;
    root.plan = { x: 0, y: 0, w: WORLD, h: WORLD };
    this.hover = null;
    this.cam = this.fitCam(root, 0.94);
    this.build = withBuild && !REDUCED ? 0 : 1;
    this.dirty = true;
  }

  /** Drive city construction from the scan progress (0..1). */
  setBuild(p: number): void {
    this.build = REDUCED ? 1 : p;
    this.dirty = true;
  }

  invalidate(): void { this.dirty = true; }

  /** Lay out every ancestor of `node` so its plan rect exists (palette jumps). */
  ensureLayout(node: FsNode): void {
    const chain: FsNode[] = [];
    let cur: FsNode | null = node;
    while (cur) { chain.unshift(cur); cur = cur.parent; }
    for (const a of chain) if (a.plan && a.children?.length) layoutChildren(a);
  }

  // ------------------------------------------------------------- camera

  private project(x: number, y: number, z: number): [number, number] {
    const k = this.cam.k;
    const ox = this.cw / 2 - (this.cam.cx - this.cam.cy) * k;
    const oy = this.ch / 2 - (this.cam.cx + this.cam.cy) * 0.5 * k;
    return [(x - y) * k + ox, ((x + y) * 0.5 - z) * k + oy];
  }

  private unproject(sx: number, sy: number): [number, number] {
    const k = this.cam.k;
    const ox = this.cw / 2 - (this.cam.cx - this.cam.cy) * k;
    const oy = this.ch / 2 - (this.cam.cx + this.cam.cy) * 0.5 * k;
    const u = (sx - ox) / k, v = (sy - oy) / k;
    return [u / 2 + v, v - u / 2];
  }

  private fitCam(node: FsNode, margin = 0.84): Camera {
    const p = node.plan!;
    const span = p.w + p.h;
    const k = Math.min(this.cw * margin / span, (this.ch * margin) / (span * 0.5 + HEADROOM));
    return { cx: p.x + p.w / 2, cy: p.y + p.h / 2, k: Math.max(k, 0.05) };
  }

  flyTo(node: FsNode, dur = 620): void {
    if (!node.plan) return;
    this.animateTo(this.fitCam(node, node === this.root ? 0.94 : 0.88), dur);
  }

  private animateTo(t: Camera, dur: number): void {
    this.anim = { f: { ...this.cam }, t, t0: performance.now(), dur: REDUCED ? 0 : dur };
    this.dirty = true;
  }

  private tick(): void {
    if (this.anim) {
      const a = this.anim;
      const p = a.dur <= 0 ? 1 : Math.min(1, (performance.now() - a.t0) / a.dur);
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      this.cam.k = Math.exp(Math.log(a.f.k) + (Math.log(a.t.k) - Math.log(a.f.k)) * e);
      this.cam.cx = a.f.cx + (a.t.cx - a.f.cx) * e;
      this.cam.cy = a.f.cy + (a.t.cy - a.f.cy) * e;
      if (p >= 1) this.anim = null;
      this.dirty = true;
    }
    if (this.dirty) { this.dirty = false; this.draw(); }
  }

  private resize(): void {
    const el = this.canvas.parentElement!;
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    const first = !this.cw;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.cw = w; this.ch = h;
    if (first && this.root) this.cam = this.fitCam(this.root, 0.94);
    this.dirty = true;
  }

  // -------------------------------------------------------- interaction

  private bind(): void {
    const c = this.canvas;
    let downX = 0, downY = 0, panning = false, moved = false;

    c.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      downX = e.clientX; downY = e.clientY; panning = true; moved = false;
      try { c.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    });
    c.addEventListener('pointermove', e => {
      const r = c.getBoundingClientRect();
      if (panning) {
        const dx = e.clientX - downX, dy = e.clientY - downY;
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        if (moved) {
          this.anim = null;
          const k = this.cam.k;
          this.cam.cx -= (dx / k + 2 * dy / k) / 2;
          this.cam.cy -= (2 * dy / k - dx / k) / 2;
          downX = e.clientX; downY = e.clientY;
          this.dirty = true;
        }
      }
      const hit = this.hitTest(e.clientX - r.left, e.clientY - r.top);
      if (hit !== this.hover) {
        this.hover = hit; this.dirty = true;
        this.events.onHover(hit);
      }
      c.style.cursor = panning && moved ? 'grabbing' : hit ? 'pointer' : 'default';
    });
    c.addEventListener('pointerup', e => {
      if (!panning) return;
      panning = false;
      try { c.releasePointerCapture(e.pointerId); } catch { /* synthetic */ }
      if (!moved) {
        const r = c.getBoundingClientRect();
        this.events.onSelect(this.hitTest(e.clientX - r.left, e.clientY - r.top));
      }
    });
    c.addEventListener('pointerleave', () => {
      if (this.hover) { this.hover = null; this.dirty = true; this.events.onHover(null); }
    });
    c.addEventListener('dblclick', e => {
      const r = c.getBoundingClientRect();
      const hit = this.hitTest(e.clientX - r.left, e.clientY - r.top);
      const target = hit && (hit.kind === 'dir' ? hit : hit.parent);
      if (target?.plan) { this.events.onFocus(target); this.flyTo(target); }
    });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      this.anim = null;
      const r = c.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const [wx, wy] = this.unproject(sx, sy);
      const factor = Math.exp(-e.deltaY * 0.0016);
      const fitK = this.root ? this.fitCam(this.root, 0.94).k : 0.1;
      const k2 = Math.max(fitK * 0.55, Math.min(60, this.cam.k * factor));
      // keep the ground point under the cursor fixed
      const ratio = this.cam.k / k2;
      this.cam.cx = wx + (this.cam.cx - wx) * ratio;
      this.cam.cy = wy + (this.cam.cy - wy) * ratio;
      this.cam.k = k2;
      this.dirty = true;
    }, { passive: false });
  }

  hitTest(sx: number, sy: number): FsNode | null {
    // front-to-back over last frame's silhouettes: pixel-accurate, towers included
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (pointInPoly(sx, sy, h.poly)) return h.n;
    }
    return null;
  }

  // ------------------------------------------------------------ drawing

  private draw(): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.labels = [];
    this.hits = [];

    // sky and ground
    const sky = ctx.createLinearGradient(0, 0, 0, this.ch);
    sky.addColorStop(0, '#0a0d17');
    sky.addColorStop(0.45, '#07080d');
    sky.addColorStop(1, '#05060a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.cw, this.ch);

    if (!this.root?.plan) return;

    this.drawGrid();
    this.drawNode(this.root, 0, 0);

    // edge fog: the city fades into the night at the borders
    const fog = ctx.createRadialGradient(
      this.cw / 2, this.ch / 2, Math.min(this.cw, this.ch) * 0.34,
      this.cw / 2, this.ch / 2, Math.max(this.cw, this.ch) * 0.78,
    );
    fog.addColorStop(0, 'rgba(5,6,10,0)');
    fog.addColorStop(1, 'rgba(5,6,10,0.86)');
    ctx.fillStyle = fog;
    ctx.fillRect(0, 0, this.cw, this.ch);

    this.drawLabels();
    this.drawMinimap();
  }

  private drawGrid(): void {
    const { ctx } = this;
    const step = 64;
    ctx.strokeStyle = 'rgba(148,163,210,0.035)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let g = 0; g <= WORLD; g += step) {
      let [x1, y1] = this.project(g, -40, 0), [x2, y2] = this.project(g, WORLD + 40, 0);
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      [x1, y1] = this.project(-40, g, 0); [x2, y2] = this.project(WORLD + 40, g, 0);
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    }
    ctx.stroke();
  }

  private nodeRgb(n: FsNode): [number, number, number] {
    if (state.layer === 'age') {
      const p = Math.min(1, Math.log1p(n.days) / Math.log1p(1200));
      const q = Math.round(p * 48);
      return rgbOf(`age${q}`, `hsl(${215 - (q / 48) * 190} ${60 + (q / 48) * 25}% ${50 + (q / 48) * 8}%)`);
    }
    return rgbOf(n.cat, CAT_COLOR[n.cat]);
  }

  /** Draw an iso box; returns its silhouette polygon (screen coords). */
  private box(p: { x: number; y: number; w: number; h: number }, z0: number, hgt: number,
    rgb: [number, number, number], lit: number, alpha: number): number[] {
    const { ctx } = this;
    const zT = z0 + hgt;
    const [ax, ay] = this.project(p.x, p.y, zT);
    const [bx, by] = this.project(p.x + p.w, p.y, zT);
    const [cx2, cy2] = this.project(p.x + p.w, p.y + p.h, zT);
    const [dx, dy] = this.project(p.x, p.y + p.h, zT);
    const [bx0, by0] = this.project(p.x + p.w, p.y, z0);
    const [cx0, cy0] = this.project(p.x + p.w, p.y + p.h, z0);
    const [dx0, dy0] = this.project(p.x, p.y + p.h, z0);

    ctx.globalAlpha = alpha;
    // left face (SW)
    ctx.fillStyle = shade(rgb, 0.27 * lit);
    ctx.beginPath();
    ctx.moveTo(dx, dy); ctx.lineTo(cx2, cy2); ctx.lineTo(cx0, cy0); ctx.lineTo(dx0, dy0);
    ctx.closePath(); ctx.fill();
    // right face (SE)
    ctx.fillStyle = shade(rgb, 0.44 * lit);
    ctx.beginPath();
    ctx.moveTo(cx2, cy2); ctx.lineTo(bx, by); ctx.lineTo(bx0, by0); ctx.lineTo(cx0, cy0);
    ctx.closePath(); ctx.fill();
    // top face
    ctx.fillStyle = shade(rgb, 0.88 * lit, 0.1);
    ctx.beginPath();
    ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx2, cy2); ctx.lineTo(dx, dy);
    ctx.closePath(); ctx.fill();
    // top rim
    ctx.strokeStyle = shade(rgb, Math.min(1.6, 1.15 * lit), 0.35);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;

    return [ax, ay, bx, by, bx0, by0, cx0, cy0, dx0, dy0, dx, dy];
  }

  private shadow(p: { x: number; y: number; w: number; h: number }, z0: number, hgt: number, alpha: number): void {
    const { ctx } = this;
    const off = hgt * 0.62;
    const [bx, by] = this.project(p.x + p.w, p.y, z0);
    const [cx2, cy2] = this.project(p.x + p.w, p.y + p.h, z0);
    const [dx, dy] = this.project(p.x, p.y + p.h, z0);
    const k = this.cam.k;
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + off * 0.5 * k, by + off * 0.25 * k);
    ctx.lineTo(cx2 + off * 0.5 * k, cy2 + off * 0.25 * k);
    ctx.lineTo(dx + off * 0.5 * k, dy + off * 0.25 * k);
    ctx.lineTo(dx, dy);
    ctx.lineTo(cx2, cy2);
    ctx.closePath();
    ctx.fill();
  }

  private growth(n: FsNode): number {
    if (this.build >= 1) return 1;
    const d = ((n.id * 2654435761) % 1000) / 1000 * 0.55;
    const p = Math.max(0, Math.min(1, (this.build - d) / 0.45));
    return 1 - Math.pow(1 - p, 3);
  }

  private drawNode(n: FsNode, z0: number, depth: number): void {
    const p = n.plan!;
    const k = this.cam.k;
    const spanW = (p.w + p.h) * k;
    // cull via projected bbox
    const [lx] = this.project(p.x, p.y + p.h, 0);
    const [rx] = this.project(p.x + p.w, p.y, 0);
    const [, ty] = this.project(p.x, p.y, 90);
    const [, byy] = this.project(p.x + p.w, p.y + p.h, 0);
    if (rx < 0 || lx > this.cw || byy < 0 || ty > this.ch) return;
    if (spanW < 3) return;

    const g = this.growth(n);
    if (g <= 0.01) return;
    const dim = !isVisible(n);
    const rgb = this.nodeRgb(n);
    const hovered = this.hover === n, selected = state.selection === n;
    const lit = hovered || selected ? 1.35 : 1;

    if (n === this.root) {
      for (const c of sorted(layoutChildren(n))) this.drawNode(c, z0, depth + 1);
      return;
    }

    if (dim) {
      // powered-down slab: the city goes dark where the filter says no
      const poly = this.box(p, z0, 2, [110, 118, 138], 0.5, 0.35);
      this.hits.push({ n, poly });
      return;
    }

    const open = n.kind === 'dir' && !!n.children?.length && spanW > OPEN_W;

    if (open) {
      this.shadow(p, z0, PLATE_H, 0.22 * g);
      const poly = this.box(p, z0, PLATE_H * g, rgb, 0.3, 0.92);
      this.hits.push({ n, poly });
      // label only when the district is visually distinct from its parent:
      // a nested plate covering most of the parent inherits its label
      const par = n.parent?.plan;
      const frac = par ? (p.w * p.h) / (par.w * par.h) : 0;
      const inside = spanW > Math.max(this.cw, this.ch) * 1.15; // you are IN it
      if (spanW > 170 && !inside && (n.parent === this.root || frac < 0.66)) {
        // street-sign position: the plate's near (south) corner, in front
        // of the district's own towers
        const [lxs, lys] = this.project(p.x + p.w * 0.82, p.y + p.h * 0.82, 0);
        this.labels.push({
          text: n.name.toUpperCase(), sub: spanW > 300 ? fmtBytes(n.size) : '',
          x: lxs, y: lys + 16, big: false,
        });
      }
      for (const c of sorted(layoutChildren(n))) this.drawNode(c, z0 + PLATE_H * g, depth + 1);
    } else if (n.kind === 'rest') {
      const poly = this.box(p, z0, 1.6 * g, [120, 128, 148], 0.55, 0.5);
      this.hits.push({ n, poly });
    } else {
      const hgt = buildingHeight(n) * g;
      this.shadow(p, z0, hgt, 0.3 * g);
      const glow = n.size > 8 * 1024 ** 3;
      if (glow && spanW > 26) {
        const [gx, gy] = this.project(p.x + p.w / 2, p.y + p.h / 2, 0);
        const rad = spanW * 0.9;
        const halo = this.ctx.createRadialGradient(gx, gy, 0, gx, gy, rad);
        halo.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.16)`);
        halo.addColorStop(1, 'rgba(0,0,0,0)');
        this.ctx.fillStyle = halo;
        this.ctx.fillRect(gx - rad, gy - rad, rad * 2, rad * 2);
      }
      const poly = this.box(p, z0, hgt, rgb, lit * (glow ? 1.12 : 1), 1);
      this.hits.push({ n, poly });

      if (selected) {
        // light beam rising from the selection
        const [tx1, ty1] = this.project(p.x + p.w / 2, p.y + p.h / 2, z0 + hgt);
        const beamH = Math.min(140, this.ch * 0.22);
        const beam = this.ctx.createLinearGradient(0, ty1 - beamH, 0, ty1);
        beam.addColorStop(0, 'rgba(139,123,255,0)');
        beam.addColorStop(1, 'rgba(139,123,255,0.35)');
        this.ctx.fillStyle = beam;
        const bw = Math.max(2, spanW * 0.05);
        this.ctx.fillRect(tx1 - bw / 2, ty1 - beamH, bw, beamH);
      }
      if (spanW > 96 && (n.kind === 'dir' || spanW > 130 || hovered)) {
        const [cxs] = this.project(p.x + p.w / 2, p.y + p.h / 2, 0);
        const [, tys] = this.project(p.x + p.w / 2, p.y + p.h / 2, z0 + hgt);
        this.labels.push({ text: n.name, sub: fmtBytes(n.size), x: cxs, y: tys - (p.w + p.h) * 0.25 * k - 8, big: true });
      }
    }
  }

  private drawLabels(): void {
    const { ctx } = this;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (const l of this.labels) {
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 6;
      if (l.big) {
        ctx.font = `600 12px 'Space Grotesk Variable','Segoe UI',sans-serif`;
        ctx.fillStyle = 'rgba(236,240,250,0.95)';
        ctx.fillText(clip(l.text, 26), l.x, l.y - 13);
        ctx.font = `500 10.5px Consolas,monospace`;
        ctx.fillStyle = 'rgba(165,173,196,0.9)';
        ctx.fillText(l.sub, l.x, l.y);
      } else {
        ctx.font = `600 11px 'Space Grotesk Variable','Segoe UI',sans-serif`;
        ctx.fillStyle = 'rgba(210,217,235,0.75)';
        const t = clip(l.text, 30);
        ctx.fillText(t, l.x, l.y - 12);
        ctx.font = `500 10px Consolas,monospace`;
        ctx.fillStyle = 'rgba(150,158,180,0.7)';
        ctx.fillText(l.sub, l.x, l.y);
      }
      ctx.shadowBlur = 0;
    }
  }

  private drawMinimap(): void {
    const mini = this.mini;
    if (!mini || !this.root) return;
    const mctx = mini.getContext('2d')!;
    const mw = mini.width, mh = mini.height;
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, mw, mh);
    const s = mw / WORLD;
    for (const c of layoutChildren(this.root)) {
      const p = c.plan!;
      const rgb = this.nodeRgb(c);
      mctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${isVisible(c) ? 0.5 : 0.1})`;
      mctx.fillRect(p.x * s, p.y * s, p.w * s, p.h * s);
    }
    // viewport diamond
    const q = [
      this.unproject(0, 0), this.unproject(this.cw, 0),
      this.unproject(this.cw, this.ch), this.unproject(0, this.ch),
    ];
    mctx.strokeStyle = 'rgba(236,240,250,0.7)';
    mctx.lineWidth = 1;
    mctx.beginPath();
    q.forEach(([x, y], i) => i === 0 ? mctx.moveTo(x * s, y * s) : mctx.lineTo(x * s, y * s));
    mctx.closePath();
    mctx.stroke();
  }
}

// ------------------------------------------------------------- utilities

function sorted(kids: FsNode[]): FsNode[] {
  // painter order: back-to-front along the iso depth axis
  return [...kids].sort((a, b) =>
    (a.plan!.x + a.plan!.y + (a.plan!.w + a.plan!.h) / 2) -
    (b.plan!.x + b.plan!.y + (b.plan!.w + b.plan!.h) / 2));
}

function pointInPoly(x: number, y: number, poly: number[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…';
}

/** Tiny standalone skyline for the disk-select cards. */
export function drawSkyline(canvas: HTMLCanvasElement, root: FsNode): void {
  root.plan = { x: 0, y: 0, w: WORLD, h: WORLD };
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width, hh = canvas.height;
  ctx.clearRect(0, 0, w, hh);
  const k = (w * 0.8) / (WORLD * 2);
  const ox = w / 2, oy = hh * 0.72;
  const pr = (x: number, y: number, z: number): [number, number] =>
    [(x - y) * k + ox, ((x + y) * 0.5 - z) * k * 1.6 + oy - WORLD * 0.5 * k * 1.6];
  const kids = sorted(layoutChildren(root));
  for (const n of kids) {
    const p = n.plan!;
    const rgb = rgbOf(n.cat, CAT_COLOR[n.cat]);
    const hgt = n.kind === 'dir' ? 30 + Math.min(60, n.size / (12 * 1024 ** 3)) : buildingHeight(n);
    const zT = hgt;
    const [ax, ay] = pr(p.x, p.y, zT); const [bx, by] = pr(p.x + p.w, p.y, zT);
    const [cx, cy] = pr(p.x + p.w, p.y + p.h, zT); const [dx, dy] = pr(p.x, p.y + p.h, zT);
    const [bx0, by0] = pr(p.x + p.w, p.y, 0); const [cx0, cy0] = pr(p.x + p.w, p.y + p.h, 0);
    const [dx0, dy0] = pr(p.x, p.y + p.h, 0);
    ctx.fillStyle = shade(rgb, 0.3);
    ctx.beginPath(); ctx.moveTo(dx, dy); ctx.lineTo(cx, cy); ctx.lineTo(cx0, cy0); ctx.lineTo(dx0, dy0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade(rgb, 0.48);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(bx, by); ctx.lineTo(bx0, by0); ctx.lineTo(cx0, cy0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade(rgb, 0.85, 0.15);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.lineTo(dx, dy); ctx.closePath(); ctx.fill();
  }
}
