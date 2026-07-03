import { layoutChildren } from './treemap';
import { isVisible, state } from './state';
import { CAT_COLOR, fmtBytes, type FsNode, type Rect } from './types';

/**
 * The storage map: a zoomable "city" built from a squarified layout.
 * Hand-rolled Canvas2D — culling + LOD keeps draw calls in the hundreds,
 * so pan/zoom stays at 60fps without any rendering dependency.
 */

const WORLD_W = 1640;
const WORLD_H = 1000;
const OPEN_MIN_W = 190;  // screen px before a district "opens" its children
const OPEN_MIN_H = 150;

interface Camera { x: number; y: number; k: number; }

interface CamAnim { fx: number; fy: number; fk: number; tx: number; ty: number; tk: number; t0: number; dur: number; }

export interface MapEvents {
  onSelect(node: FsNode | null): void;
  onFocus(node: FsNode): void;
  onHover(node: FsNode | null, sx: number, sy: number): void;
}

export class MapRenderer {
  private ctx: CanvasRenderingContext2D;
  private cam: Camera = { x: 0, y: 0, k: 1 };
  private anim: CamAnim | null = null;
  private cw = 0; private ch = 0; private dpr = 1;
  private hover: FsNode | null = null;
  private dirty = true;
  private raf = 0;
  private root: FsNode | null = null;
  private intro = 0; // intro fade-in progress 0..1, -1 = done

  constructor(private canvas: HTMLCanvasElement, private events: MapEvents) {
    this.ctx = canvas.getContext('2d')!;
    this.bind();
    this.resize(); // measure synchronously — camera math needs real dimensions
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.tick();
    };
    this.raf = requestAnimationFrame(loop);
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement!);
  }

  destroy(): void { cancelAnimationFrame(this.raf); }

  setRoot(root: FsNode): void {
    this.root = root;
    root.rect = { x: 0, y: 0, w: WORLD_W, h: WORLD_H };
    this.hover = null;
    if (this.cw > 0 && this.ch > 0) {
      // intro: start pulled back, fly to fit
      const fit = this.fitCamera(root.rect, 0.94);
      this.cam = { x: fit.x + WORLD_W * 0.18, y: fit.y + WORLD_H * 0.3, k: fit.k * 0.62 };
      this.intro = 0;
      this.flyTo(root, 900);
    }
    this.dirty = true;
  }

  invalidate(): void { this.dirty = true; }

  // ---------------------------------------------------------------- camera

  private fitCamera(r: Rect, margin = 0.92): Camera {
    const k = Math.min(this.cw / r.w, this.ch / r.h) * margin;
    return { k, x: r.x + r.w / 2 - this.cw / (2 * k), y: r.y + r.h / 2 - this.ch / (2 * k) };
  }

  flyTo(node: FsNode, dur = 520): void {
    if (!node.rect) return;
    const t = this.fitCamera(node.rect, node === this.root ? 0.94 : 0.9);
    this.anim = {
      fx: this.cam.x, fy: this.cam.y, fk: this.cam.k,
      tx: t.x, ty: t.y, tk: t.k, t0: performance.now(), dur,
    };
    this.dirty = true;
  }

  private tick(): void {
    if (this.anim) {
      const a = this.anim;
      const p = Math.min(1, (performance.now() - a.t0) / a.dur);
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      this.cam.k = a.fk > 0 && a.tk > 0
        ? Math.exp(Math.log(a.fk) + (Math.log(a.tk) - Math.log(a.fk)) * e)
        : a.fk + (a.tk - a.fk) * e;
      this.cam.x = a.fx + (a.tx - a.fx) * e;
      this.cam.y = a.fy + (a.ty - a.fy) * e;
      if (p >= 1) this.anim = null;
      this.dirty = true;
    }
    if (this.intro >= 0 && this.intro < 1) { this.intro = Math.min(1, this.intro + 0.02); this.dirty = true; }
    if (this.dirty) { this.dirty = false; this.draw(); }
  }

  private resize(): void {
    const el = this.canvas.parentElement!;
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    const prevW = this.cw, prevH = this.ch;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.cw = w; this.ch = h;
    if (!prevW && this.root?.rect) { // first layout
      this.cam = this.fitCamera(this.root.rect, 0.94);
    } else if (prevW && prevH) {
      this.cam.x -= (w - prevW) / (2 * this.cam.k);
      this.cam.y -= (h - prevH) / (2 * this.cam.k);
    }
    this.dirty = true;
  }

  // ------------------------------------------------------------ interaction

  private bind(): void {
    const c = this.canvas;
    let downX = 0, downY = 0, panning = false, moved = false;

    c.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      downX = e.clientX; downY = e.clientY; panning = true; moved = false;
      try { c.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    });
    c.addEventListener('pointermove', e => {
      const r = c.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      if (panning) {
        const dx = e.clientX - downX, dy = e.clientY - downY;
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        if (moved) {
          this.anim = null;
          this.cam.x -= dx / this.cam.k; this.cam.y -= dy / this.cam.k;
          downX = e.clientX; downY = e.clientY;
          this.dirty = true;
        }
      }
      const hit = this.hitTest(sx, sy);
      if (hit !== this.hover) { this.hover = hit; this.dirty = true; }
      this.events.onHover(moved ? null : hit, e.clientX, e.clientY);
      c.style.cursor = panning && moved ? 'grabbing' : hit ? 'pointer' : 'default';
    });
    c.addEventListener('pointerup', e => {
      if (!panning) return;
      panning = false;
      try { c.releasePointerCapture(e.pointerId); } catch { /* synthetic events */ }
      if (!moved) {
        const r = c.getBoundingClientRect();
        const hit = this.hitTest(e.clientX - r.left, e.clientY - r.top);
        this.events.onSelect(hit);
      }
    });
    c.addEventListener('pointerleave', () => {
      if (this.hover) { this.hover = null; this.dirty = true; }
      this.events.onHover(null, 0, 0);
    });
    c.addEventListener('dblclick', e => {
      const r = c.getBoundingClientRect();
      const hit = this.hitTest(e.clientX - r.left, e.clientY - r.top);
      const target = hit && (hit.kind === 'dir' ? hit : hit.parent);
      if (target && target.rect) { this.events.onFocus(target); this.flyTo(target); }
    });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      this.anim = null;
      const r = c.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const factor = Math.exp(-e.deltaY * 0.0016);
      const fitK = Math.min(this.cw / WORLD_W, this.ch / WORLD_H) * 0.94;
      const k = Math.max(fitK * 0.55, Math.min(4000, this.cam.k * factor));
      const wx = this.cam.x + sx / this.cam.k, wy = this.cam.y + sy / this.cam.k;
      this.cam.k = k;
      this.cam.x = wx - sx / k; this.cam.y = wy - sy / k;
      this.dirty = true;
    }, { passive: false });
  }

  private isOpen(n: FsNode, sw: number, sh: number): boolean {
    return n.kind === 'dir' && !!n.children?.length && sw > OPEN_MIN_W && sh > OPEN_MIN_H;
  }

  hitTest(sx: number, sy: number): FsNode | null {
    if (!this.root?.rect) return null;
    const wx = this.cam.x + sx / this.cam.k, wy = this.cam.y + sy / this.cam.k;
    const walk = (n: FsNode): FsNode | null => {
      const r = n.rect!;
      if (wx < r.x || wy < r.y || wx > r.x + r.w || wy > r.y + r.h) return null;
      const sw = r.w * this.cam.k, sh = r.h * this.cam.k;
      if (this.isOpen(n, sw, sh)) {
        for (const c of layoutChildren(n, r)) {
          const hit = walk(c);
          if (hit) return hit;
        }
        return n; // padding / label band → the district itself
      }
      return sw > 3 && sh > 3 ? n : null;
    };
    return walk(this.root);
  }

  // ---------------------------------------------------------------- drawing

  private draw(): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // deep background with a soft top glow
    ctx.fillStyle = '#07090f';
    ctx.fillRect(0, 0, this.cw, this.ch);
    const g = ctx.createRadialGradient(this.cw / 2, -this.ch * 0.4, 0, this.cw / 2, -this.ch * 0.4, this.ch * 1.4);
    g.addColorStop(0, 'rgba(90,110,190,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.cw, this.ch);
    // faint dot grid — gives the void a cartographic texture
    ctx.fillStyle = 'rgba(148,163,196,0.055)';
    for (let y = 10; y < this.ch; y += 26)
      for (let x = 10; x < this.cw; x += 26)
        ctx.fillRect(x, y, 1.2, 1.2);

    if (!this.root?.rect) return;
    if (this.intro >= 0) ctx.globalAlpha = this.intro >= 1 ? 1 : 0.15 + 0.85 * this.intro;
    this.drawNode(this.root, 0);
    ctx.globalAlpha = 1;
    if (this.intro >= 1) this.intro = -1;
  }

  private screenRect(r: Rect): Rect {
    return {
      x: (r.x - this.cam.x) * this.cam.k,
      y: (r.y - this.cam.y) * this.cam.k,
      w: r.w * this.cam.k,
      h: r.h * this.cam.k,
    };
  }

  private nodeColor(n: FsNode): string {
    if (state.layer === 'age') {
      // heat: fresh = cool blue, ancient = hot ember
      const t = Math.min(1, Math.log1p(n.days) / Math.log1p(1200));
      const h = 215 - t * 190;         // 215 (blue) → 25 (orange)
      const s = 60 + t * 25;
      const l = 52 + t * 6;
      return `hsl(${h} ${s}% ${l}%)`;
    }
    return CAT_COLOR[n.cat];
  }

  private drawNode(n: FsNode, depth: number): void {
    const s = this.screenRect(n.rect!);
    if (s.x > this.cw || s.y > this.ch || s.x + s.w < 0 || s.y + s.h < 0) return;
    if (s.w < 0.8 || s.h < 0.8) return;

    const { ctx } = this;
    const dim = !isVisible(n);
    const open = this.isOpen(n, s.w, s.h) && !dim;
    const color = this.nodeColor(n);
    const rad = Math.max(1.5, Math.min(9, Math.min(s.w, s.h) * 0.09));
    const hovered = this.hover === n;
    const selected = state.selection === n;

    if (open) {
      // district container
      ctx.beginPath(); this.rr(s, rad);
      ctx.fillStyle = depth === 0 ? 'rgba(148,163,196,0.05)' : this.tint(color, 0.07);
      ctx.fill();
      ctx.strokeStyle = depth === 0 ? 'rgba(255,255,255,0.06)' : this.tint(color, 0.22);
      ctx.lineWidth = 1;
      ctx.stroke();

      // district label — map-style, uppercase, sized to fit the reserved band
      const bandPx = Math.min(s.w, s.h) * 0.035 * 2.6;
      const fs = Math.min(12, bandPx * 0.62);
      if (s.w > 64 && depth > 0 && fs >= 8) {
        ctx.font = `600 ${fs}px 'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif`;
        ctx.fillStyle = 'rgba(226,232,246,0.82)';
        ctx.textBaseline = 'top';
        const label = n.name.toUpperCase();
        const maxW = s.w - 16;
        const size = fmtBytes(n.size);
        const ty = s.y + Math.max(3, (bandPx - fs) * 0.42);
        ctx.save();
        ctx.beginPath(); ctx.rect(s.x + 8, ty - 1, maxW, fs + 4); ctx.clip();
        ctx.fillText(label, s.x + 9, ty);
        ctx.restore();
        const lw = ctx.measureText(label).width;
        if (lw + 60 < maxW) {
          ctx.fillStyle = 'rgba(139,147,167,0.7)';
          ctx.font = `500 ${fs * 0.92}px 'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif`;
          ctx.fillText(size, s.x + 14 + lw, ty + 0.5);
        }
      }
      for (const c of layoutChildren(n, n.rect!)) this.drawNode(c, depth + 1);
    } else {
      // closed block — building
      const prevAlpha = ctx.globalAlpha;
      if (dim) ctx.globalAlpha = prevAlpha * 0.07;
      const isDir = n.kind === 'dir';
      const isRest = n.kind === 'rest';
      ctx.beginPath(); this.rr(s, rad);
      if (isRest) {
        ctx.fillStyle = 'rgba(148,163,184,0.07)';
        ctx.fill();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = 'rgba(148,163,184,0.28)';
        ctx.lineWidth = 1; ctx.stroke();
        ctx.setLineDash([]);
      } else {
        const glow = n.size > 8 * 1024 ** 3 && s.w > 26 && !dim;
        if (glow) { ctx.save(); ctx.shadowColor = this.tint(color, 0.6); ctx.shadowBlur = Math.min(30, s.w * 0.14); }
        ctx.fillStyle = this.tint(color, isDir ? 0.50 : 0.60);
        ctx.fill();
        if (glow) ctx.restore();
        ctx.strokeStyle = this.tint(color, isDir ? 0.85 : 0.95);
        ctx.lineWidth = 1;
        ctx.stroke();
        // subtle top highlight for a "lit building" feel
        if (s.h > 18 && !dim) {
          const hg = ctx.createLinearGradient(0, s.y, 0, s.y + s.h);
          hg.addColorStop(0, 'rgba(255,255,255,0.10)');
          hg.addColorStop(0.35, 'rgba(255,255,255,0)');
          ctx.beginPath(); this.rr(s, rad);
          ctx.fillStyle = hg; ctx.fill();
        }
      }
      // block label
      if (s.w > 54 && s.h > 30) {
        const fs = Math.min(12.5, Math.max(9.5, Math.min(s.w * 0.085, s.h * 0.2)));
        ctx.font = `600 ${fs}px 'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif`;
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = isRest ? 'rgba(148,163,184,0.75)' : 'rgba(235,240,252,0.94)';
        const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
        ctx.textAlign = 'center';
        ctx.save();
        ctx.beginPath(); ctx.rect(s.x + 3, s.y, s.w - 6, s.h); ctx.clip();
        ctx.fillText(this.ellipsis(n.name, s.w - 12, fs), cx, cy - 1);
        if (s.h > 46) {
          ctx.font = `500 ${fs * 0.85}px 'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif`;
          ctx.fillStyle = 'rgba(180,190,210,0.72)';
          ctx.fillText(fmtBytes(n.size), cx, cy + fs + 1);
        }
        ctx.restore();
        ctx.textAlign = 'left';
      }
      ctx.globalAlpha = prevAlpha;
    }

    if ((hovered || selected) && !dim) {
      ctx.beginPath(); this.rr(s, rad);
      ctx.strokeStyle = selected ? '#8b7bff' : 'rgba(255,255,255,0.55)';
      ctx.lineWidth = selected ? 2 : 1.4;
      if (selected) { ctx.save(); ctx.shadowColor = 'rgba(124,92,255,0.8)'; ctx.shadowBlur = 14; ctx.stroke(); ctx.restore(); }
      else ctx.stroke();
    }
  }

  private ellipsis(text: string, maxW: number, fs: number): string {
    const approx = Math.max(3, Math.floor(maxW / (fs * 0.56)));
    return text.length <= approx ? text : text.slice(0, approx - 1) + '…';
  }

  private rr(s: Rect, r: number): void {
    this.ctx.roundRect(s.x, s.y, s.w, s.h, r);
  }

  /** color with alpha, accepts #rrggbb or hsl(h s% l%) */
  private tint(color: string, a: number): string {
    if (color.startsWith('#')) {
      const v = parseInt(color.slice(1), 16);
      return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
    }
    return color.replace(')', ` / ${a})`);
  }
}
