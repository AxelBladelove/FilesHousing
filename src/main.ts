import { buildDisks } from './mockData';
import { MapRenderer } from './renderer';
import {
  emit, filtersActive, inQueue, queueTotal, recomputeVisibility,
  state, subscribe, toggleQueue,
} from './state';
import {
  CAT_COLOR, CAT_LABEL, fmtAge, fmtBytes, nodePath,
  type Cat, type Disk, type FsNode,
} from './types';

const app = document.getElementById('app')!;
const disks = buildDisks();
let map: MapRenderer | null = null;

const GB = 1024 ** 3;
const MB = 1024 ** 2;

// ----------------------------------------------------------------- helpers

function h(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

function catDot(cat: Cat): string {
  return `<i class="dot" style="background:${CAT_COLOR[cat]}"></i>`;
}

// ------------------------------------------------------------- disk screen

function renderDisks(): void {
  map?.destroy(); map = null;
  const cards = disks.map((d, i) => {
    const used = d.root.size, pct = Math.round((used / d.totalBytes) * 100);
    return `
      <button class="disk-card" data-i="${i}" style="animation-delay:${i * 90}ms">
        <div class="disk-head">
          <span class="disk-letter">${d.letter}:</span>
          <span class="disk-label">${d.label}</span>
          <span class="disk-pct">${pct}%</span>
        </div>
        <div class="disk-bar"><i style="width:${pct}%" class="${pct > 85 ? 'hot' : ''}"></i></div>
        <div class="disk-stats">
          <span>${fmtBytes(used)} used</span>
          <span>${fmtBytes(d.totalBytes - used)} free of ${fmtBytes(d.totalBytes)}</span>
        </div>
        <div class="disk-scan">Scan disk<span class="arrow">→</span></div>
      </button>`;
  }).join('');

  app.innerHTML = '';
  app.append(h(`
    <div class="screen disks-screen">
      <div class="brand">
        <div class="logo">FH</div>
        <h1>FilesHousing</h1>
        <p>Pick a disk and understand where your space went — in under a minute.</p>
      </div>
      <div class="disk-cards">${cards}</div>
      <footer class="foot-note">UI preview build · mock filesystem · backend pending</footer>
    </div>`));

  app.querySelectorAll<HTMLElement>('.disk-card').forEach(el =>
    el.addEventListener('click', () => startScan(disks[Number(el.dataset.i)])));
}

// ------------------------------------------------------------- scan screen

function startScan(disk: Disk): void {
  state.disk = disk;
  state.screen = 'scan';
  state.selection = null; state.focus = disk.root;
  state.query = ''; state.filters = { minSize: 0, minAgeDays: 0, cats: new Set() };
  state.queue = [];

  app.innerHTML = '';
  const el = h(`
    <div class="screen scan-screen">
      <div class="scan-inner">
        <div class="scan-title">Scanning <b>${disk.letter}: ${disk.label}</b></div>
        <div class="scan-pct">0%</div>
        <div class="scan-bar"><i style="width:0%"></i></div>
        <div class="scan-stats">
          <div><b class="s-files">0</b><span>files</span></div>
          <div><b class="s-bytes">0 GB</b><span>indexed</span></div>
          <div><b class="s-dirs">0</b><span>folders</span></div>
        </div>
        <div class="scan-path">&nbsp;</div>
      </div>
    </div>`);
  app.append(el);

  // gather sample paths for the ticker
  const paths: string[] = [];
  const collect = (n: FsNode) => {
    if (paths.length > 400) return;
    if (!n.children) { if (Math.random() < 0.25) paths.push(nodePath(n)); return; }
    for (const c of n.children) collect(c);
  };
  collect(disk.root);

  const totalFiles = disk.root.count;
  const totalBytes = disk.root.size;
  const dirCount = Math.round(totalFiles / 9);
  const dur = 2600, t0 = performance.now();
  const pctEl = el.querySelector('.scan-pct')!;
  const barEl = el.querySelector<HTMLElement>('.scan-bar i')!;
  const fEl = el.querySelector('.s-files')!, bEl = el.querySelector('.s-bytes')!, dEl = el.querySelector('.s-dirs')!;
  const pathEl = el.querySelector('.scan-path')!;
  let lastPath = 0;

  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    pctEl.textContent = Math.round(e * 100) + '%';
    barEl.style.width = (e * 100).toFixed(1) + '%';
    fEl.textContent = Math.round(e * totalFiles).toLocaleString();
    bEl.textContent = fmtBytes(e * totalBytes);
    dEl.textContent = Math.round(e * dirCount).toLocaleString();
    if (now - lastPath > 70 && p < 1) {
      pathEl.textContent = paths[Math.floor(Math.random() * paths.length)] ?? '';
      lastPath = now;
    }
    if (p < 1) requestAnimationFrame(step);
    else setTimeout(() => renderMap(), 260);
  };
  requestAnimationFrame(step);
}

// -------------------------------------------------------------- map screen

function renderMap(): void {
  const disk = state.disk!;
  state.screen = 'map';
  app.innerHTML = '';
  const el = h(`
    <div class="screen map-screen">
      <div class="canvas-wrap"><canvas></canvas></div>
      <header class="topbar">
        <button class="icon-btn back" title="Back to disks">‹</button>
        <nav class="crumbs"></nav>
        <div class="spacer"></div>
        <label class="search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input type="text" placeholder="Search files and folders" spellcheck="false" />
        </label>
        <div class="seg">
          <button data-layer="type" class="on">Type</button>
          <button data-layer="age">Age</button>
        </div>
        <button class="btn filters-btn">Filters<span class="badge" hidden></span></button>
      </header>
      <div class="filters-pop" hidden></div>
      <aside class="details" hidden></aside>
      <div class="legend"></div>
      <div class="status"></div>
      <button class="queue-tray" hidden></button>
      <div class="queue-panel" hidden></div>
      <div class="tooltip" hidden></div>
    </div>`);
  app.append(el);

  const canvas = el.querySelector('canvas')!;
  const tooltip = el.querySelector<HTMLElement>('.tooltip')!;

  map = new MapRenderer(canvas, {
    onSelect(node) {
      state.selection = node;
      emit();
    },
    onFocus(node) {
      state.focus = node;
      emit();
    },
    onHover(node, cx, cy) {
      if (!node || node === state.disk!.root) { tooltip.hidden = true; return; }
      tooltip.hidden = false;
      const share = node.size / disk.root.size;
      tooltip.innerHTML = `
        <div class="tt-name">${catDot(node.cat)}${escapeHtml(node.name)}</div>
        <div class="tt-row"><b>${fmtBytes(node.size)}</b> · ${(share * 100).toFixed(share < 0.01 ? 2 : 1)}% of disk</div>
        <div class="tt-row dim">${node.kind === 'dir' ? node.count.toLocaleString() + ' files · ' : ''}${fmtAge(node.days)}</div>`;
      const pad = 14;
      const w = tooltip.offsetWidth, hgt = tooltip.offsetHeight;
      tooltip.style.left = Math.min(cx + pad, window.innerWidth - w - 8) + 'px';
      tooltip.style.top = Math.min(cy + pad, window.innerHeight - hgt - 8) + 'px';
    },
  });
  map.setRoot(disk.root);

  // topbar events
  el.querySelector('.back')!.addEventListener('click', () => {
    if (state.focus && state.focus !== disk.root) {
      state.focus = state.focus.parent ?? disk.root;
      map!.flyTo(state.focus);
      emit();
    } else renderDisks();
  });
  const searchInput = el.querySelector<HTMLInputElement>('.search input')!;
  searchInput.addEventListener('input', () => {
    state.query = searchInput.value;
    recomputeVisibility(); map!.invalidate(); emit();
  });
  el.querySelectorAll<HTMLElement>('.seg button').forEach(b =>
    b.addEventListener('click', () => {
      state.layer = b.dataset.layer as 'type' | 'age';
      el.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b));
      map!.invalidate(); emit();
    }));
  el.querySelector('.filters-btn')!.addEventListener('click', () => {
    const pop = el.querySelector<HTMLElement>('.filters-pop')!;
    pop.hidden = !pop.hidden;
    if (!pop.hidden) renderFiltersPop(pop);
  });
  window.addEventListener('keydown', escHandler);

  subscribe(syncChrome);
  syncChrome();
}

function escHandler(e: KeyboardEvent): void {
  if (e.key === 'Escape' && state.screen === 'map') {
    state.selection = null;
    document.querySelector<HTMLElement>('.filters-pop')?.setAttribute('hidden', '');
    document.querySelector<HTMLElement>('.queue-panel')?.setAttribute('hidden', '');
    emit();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

// ------------------------------------------------------- chrome sync (map)

function syncChrome(): void {
  if (state.screen !== 'map') return;
  const disk = state.disk!;
  const el = app.querySelector('.map-screen')!;

  // breadcrumbs
  const crumbs = el.querySelector('.crumbs')!;
  const chain: FsNode[] = [];
  let cur: FsNode | null = state.focus ?? disk.root;
  while (cur) { chain.unshift(cur); cur = cur.parent; }
  crumbs.innerHTML = chain.map((n, i) =>
    `<button class="crumb ${i === chain.length - 1 ? 'cur' : ''}" data-i="${i}">${escapeHtml(n.name)}</button>`
  ).join('<span class="crumb-sep">/</span>');
  crumbs.querySelectorAll<HTMLElement>('.crumb').forEach(b =>
    b.addEventListener('click', () => {
      const n = chain[Number(b.dataset.i)];
      state.focus = n; map!.flyTo(n); emit();
    }));

  // filter badge
  const badge = el.querySelector<HTMLElement>('.filters-btn .badge')!;
  const f = state.filters;
  const activeCount = (f.minSize ? 1 : 0) + (f.minAgeDays ? 1 : 0) + (f.cats.size ? 1 : 0);
  badge.hidden = activeCount === 0;
  badge.textContent = String(activeCount);

  // legend
  const legend = el.querySelector<HTMLElement>('.legend')!;
  if (state.layer === 'type') {
    const cats: Cat[] = ['video', 'image', 'audio', 'doc', 'code', 'archive', 'app', 'game', 'system', 'data'];
    legend.innerHTML = cats.map(c => `<span class="lg-item">${catDot(c)}${CAT_LABEL[c]}</span>`).join('');
  } else {
    legend.innerHTML = `
      <span class="lg-item">Fresh</span>
      <span class="lg-grad"></span>
      <span class="lg-item">Untouched for years</span>`;
  }

  // status line
  const status = el.querySelector<HTMLElement>('.status')!;
  status.textContent = `${disk.root.count.toLocaleString()} files · ${fmtBytes(disk.root.size)} used` +
    (filtersActive() ? ' · filtered view' : '');

  syncDetails(el);
  syncQueue(el);
  map?.invalidate();
}

// ---------------------------------------------------------- details panel

function syncDetails(root: Element): void {
  const panel = root.querySelector<HTMLElement>('.details')!;
  const n = state.selection;
  if (!n || n.kind === 'rest') { panel.hidden = true; return; }
  panel.hidden = false;
  const disk = state.disk!;
  const share = (n.size / disk.root.size) * 100;
  const isDir = n.kind === 'dir';

  let childrenHtml = '';
  if (isDir && n.children) {
    const top = n.children.slice(0, 6);
    const max = top[0]?.size ?? 1;
    childrenHtml = `
      <div class="d-section">
        <div class="d-label">Largest inside</div>
        ${top.map(c => `
          <button class="d-child" data-id="${c.id}">
            <span class="d-child-name">${catDot(c.cat)}${escapeHtml(c.name)}</span>
            <span class="d-child-size">${fmtBytes(c.size)}</span>
            <i class="d-child-bar" style="width:${Math.max(3, (c.size / max) * 100)}%;background:${CAT_COLOR[c.cat]}"></i>
          </button>`).join('')}
      </div>`;
  }

  const queued = inQueue(n);
  panel.innerHTML = `
    <button class="d-close" title="Close">×</button>
    <div class="d-head">
      <div class="d-kind">${catDot(n.cat)}${isDir ? 'Folder' : CAT_LABEL[n.cat]}</div>
      <div class="d-name">${escapeHtml(n.name)}</div>
      <div class="d-path">${escapeHtml(nodePath(n))}</div>
    </div>
    <div class="d-grid">
      <div><b>${fmtBytes(n.size)}</b><span>size</span></div>
      <div><b>${share < 0.01 ? '<0.01' : share.toFixed(share < 1 ? 2 : 1)}%</b><span>of disk</span></div>
      <div><b>${isDir ? n.count.toLocaleString() : fmtAge(n.days)}</b><span>${isDir ? 'files' : 'modified'}</span></div>
    </div>
    ${childrenHtml}
    <div class="d-actions">
      ${isDir ? `<button class="btn d-zoom">Zoom to folder</button>` : ''}
      <button class="btn primary d-queue">${queued ? '✓ In cleanup queue' : 'Add to cleanup queue'}</button>
      <button class="btn ghost d-open" title="Wired to the Rust backend later">Open in Explorer</button>
    </div>`;

  panel.querySelector('.d-close')!.addEventListener('click', () => { state.selection = null; emit(); });
  panel.querySelector('.d-zoom')?.addEventListener('click', () => { state.focus = n; map!.flyTo(n); emit(); });
  panel.querySelector('.d-queue')!.addEventListener('click', () => toggleQueue(n));
  panel.querySelector('.d-open')!.addEventListener('click', () => flashNote('Preview build — Explorer integration lands with the Rust backend.'));
  panel.querySelectorAll<HTMLElement>('.d-child').forEach(b =>
    b.addEventListener('click', () => {
      const c = n.children!.find(x => x.id === Number(b.dataset.id));
      if (c) {
        state.selection = c;
        if (c.rect) { state.focus = c.kind === 'dir' ? c : n; map!.flyTo(c.kind === 'dir' ? c : n); }
        emit();
      }
    }));
}

// ------------------------------------------------------------ queue tray

function syncQueue(root: Element): void {
  const tray = root.querySelector<HTMLElement>('.queue-tray')!;
  const panel = root.querySelector<HTMLElement>('.queue-panel')!;
  if (state.queue.length === 0) { tray.hidden = true; panel.hidden = true; return; }
  tray.hidden = false;
  tray.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
    <b>${state.queue.length}</b> queued · <b>${fmtBytes(queueTotal())}</b> reclaimable`;
  tray.onclick = () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) renderQueuePanel(panel);
  };
  if (!panel.hidden) renderQueuePanel(panel);
}

function renderQueuePanel(panel: HTMLElement): void {
  panel.innerHTML = `
    <div class="q-head">Cleanup queue<span>${fmtBytes(queueTotal())} estimated recovery</span></div>
    <div class="q-list">
      ${state.queue.map((q, i) => `
        <div class="q-item">
          <span class="q-name">${catDot(q.node.cat)}${escapeHtml(q.node.name)}</span>
          <span class="q-size">${fmtBytes(q.node.size)}</span>
          <button class="q-x" data-i="${i}" title="Remove">×</button>
        </div>`).join('')}
    </div>
    <div class="q-actions">
      <button class="btn ghost q-clear">Clear</button>
      <button class="btn primary q-run">Review &amp; recycle…</button>
    </div>
    <div class="q-note">Safe by default: preview → confirm → Recycle Bin. Executed by the Rust backend.</div>`;
  panel.querySelectorAll<HTMLElement>('.q-x').forEach(b =>
    b.addEventListener('click', () => { state.queue.splice(Number(b.dataset.i), 1); emit(); }));
  panel.querySelector('.q-clear')!.addEventListener('click', () => { state.queue = []; emit(); });
  panel.querySelector('.q-run')!.addEventListener('click', () =>
    flashNote('Preview build — deletion flow ships with the backend (recycle-bin first, always reviewable).'));
}

// -------------------------------------------------------------- filters UI

function renderFiltersPop(pop: HTMLElement): void {
  const f = state.filters;
  const sizes = [[0, 'All'], [100 * MB, '≥ 100 MB'], [GB, '≥ 1 GB'], [10 * GB, '≥ 10 GB']] as const;
  const ages = [[0, 'Any age'], [183, '> 6 mo'], [365, '> 1 yr'], [730, '> 2 yr']] as const;
  const cats: Cat[] = ['video', 'image', 'audio', 'doc', 'code', 'archive', 'app', 'game', 'system', 'data', 'other'];

  pop.innerHTML = `
    <div class="f-label">Minimum size</div>
    <div class="f-row">${sizes.map(([v, l]) => `<button class="chip ${f.minSize === v ? 'on' : ''}" data-k="size" data-v="${v}">${l}</button>`).join('')}</div>
    <div class="f-label">Last modified</div>
    <div class="f-row">${ages.map(([v, l]) => `<button class="chip ${f.minAgeDays === v ? 'on' : ''}" data-k="age" data-v="${v}">${l}</button>`).join('')}</div>
    <div class="f-label">Type</div>
    <div class="f-row wrap">${cats.map(c => `<button class="chip ${f.cats.has(c) ? 'on' : ''}" data-k="cat" data-v="${c}">${catDot(c)}${CAT_LABEL[c]}</button>`).join('')}</div>
    <div class="f-foot"><button class="btn ghost f-reset">Reset all</button></div>`;

  pop.querySelectorAll<HTMLElement>('.chip').forEach(chip =>
    chip.addEventListener('click', () => {
      const k = chip.dataset.k!, v = chip.dataset.v!;
      if (k === 'size') f.minSize = Number(v);
      else if (k === 'age') f.minAgeDays = Number(v);
      else {
        const c = v as Cat;
        f.cats.has(c) ? f.cats.delete(c) : f.cats.add(c);
      }
      recomputeVisibility(); map!.invalidate(); emit();
      renderFiltersPop(pop);
    }));
  pop.querySelector('.f-reset')!.addEventListener('click', () => {
    state.filters = { minSize: 0, minAgeDays: 0, cats: new Set() };
    recomputeVisibility(); map!.invalidate(); emit();
    renderFiltersPop(pop);
  });
}

// ------------------------------------------------------------------- misc

let noteTimer = 0;
function flashNote(text: string): void {
  document.querySelector('.flash-note')?.remove();
  const n = h(`<div class="flash-note">${text}</div>`);
  document.body.append(n);
  clearTimeout(noteTimer);
  noteTimer = window.setTimeout(() => n.remove(), 3200);
}

renderDisks();
