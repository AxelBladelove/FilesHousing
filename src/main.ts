import '@fontsource-variable/space-grotesk';
import { CityRenderer, drawSkyline } from './city';
import { buildDisks } from './mockData';
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
let city: CityRenderer | null = null;
let searchIndex: { n: FsNode; l: string }[] = [];

const GB = 1024 ** 3;
const MB = 1024 ** 2;

function h(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

function catDot(cat: Cat): string {
  return `<i class="dot" style="background:${CAT_COLOR[cat]}"></i>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

// ------------------------------------------------------------- disk screen

function renderDisks(): void {
  city?.destroy(); city = null;
  const rows = disks.map((d, i) => {
    const used = d.root.size, pct = Math.round((used / d.totalBytes) * 100);
    return `
      <button class="disk-card" data-i="${i}" style="animation-delay:${160 + i * 120}ms">
        <canvas class="disk-sky" width="300" height="150"></canvas>
        <div class="disk-info">
          <div class="disk-head">
            <span class="disk-letter">${d.letter}:</span>
            <span class="disk-label">${d.label}</span>
            <span class="disk-pct">${pct}% full</span>
          </div>
          <div class="disk-bar"><i style="width:${pct}%" class="${pct > 85 ? 'hot' : ''}"></i></div>
          <div class="disk-stats"><span>${fmtBytes(used)} used</span><span>${fmtBytes(d.totalBytes - used)} free</span></div>
        </div>
        <div class="disk-enter">Enter the city<span>→</span></div>
      </button>`;
  }).join('');

  app.innerHTML = '';
  app.append(h(`
    <div class="screen disks-screen">
      <div class="hero">
        <div class="wordmark"><i></i>FilesHousing</div>
        <h1>Your disk is<br>a city.</h1>
        <p>Districts are folders. Towers are files. Fly over your storage and find what is heavy in seconds.</p>
      </div>
      <div class="disk-side">
        <div class="disk-cards">${rows}</div>
        <div class="foot-note">Preview build with mock data</div>
      </div>
    </div>`));

  app.querySelectorAll<HTMLElement>('.disk-card').forEach(el => {
    const d = disks[Number(el.dataset.i)];
    drawSkyline(el.querySelector('canvas')!, d.root);
    el.addEventListener('click', () => renderMap(d));
  });
}

// ---------------------------------------------- map screen (+ build scan)

function renderMap(disk: Disk): void {
  state.disk = disk;
  state.screen = 'map';
  state.selection = null; state.focus = disk.root;
  state.query = ''; state.filters = { minSize: 0, minAgeDays: 0, cats: new Set() };
  state.queue = [];
  recomputeVisibility();

  searchIndex = [];
  const walk = (n: FsNode) => {
    searchIndex.push({ n, l: n.name.toLowerCase() });
    n.children?.forEach(walk);
  };
  disk.root.children?.forEach(walk);

  app.innerHTML = '';
  const el = h(`
    <div class="screen map-screen">
      <div class="canvas-wrap"><canvas></canvas></div>

      <div class="hud">
        <div class="plate crumbs-plate">
          <button class="icon-btn back" title="Back">‹</button>
          <nav class="crumbs"></nav>
        </div>
        <div class="plate tools-plate">
          <button class="tool search-open">Search<kbd>Ctrl K</kbd></button>
          <span class="tool-sep"></span>
          <div class="seg">
            <button data-layer="type" class="${state.layer === 'type' ? 'on' : ''}">Type</button>
            <button data-layer="age" class="${state.layer === 'age' ? 'on' : ''}">Age</button>
          </div>
          <button class="tool filters-btn">Filters<span class="badge" hidden></span></button>
        </div>
        <div class="readout">
          <div class="r-name"></div>
          <div class="r-meta"></div>
          <div class="legend"></div>
        </div>
        <div class="corner-br">
          <button class="queue-tray" hidden></button>
          <div class="mini-wrap"><canvas class="minimap" width="176" height="176"></canvas></div>
        </div>
      </div>

      <div class="scan-overlay">
        <div class="scan-block">
          <div class="scan-title">Constructing <b>${disk.letter}: ${disk.label}</b></div>
          <div class="scan-pct">0</div>
          <div class="scan-stats"><span class="s-files">0</span> files<i></i><span class="s-bytes">0 GB</span> indexed</div>
          <div class="scan-path">&nbsp;</div>
        </div>
      </div>

      <div class="palette" hidden>
        <div class="pal-box">
          <input type="text" placeholder="Search files, folders, actions…" spellcheck="false" />
          <div class="pal-list"></div>
        </div>
      </div>

      <div class="filters-pop" hidden></div>
      <aside class="details" hidden></aside>
      <div class="queue-panel" hidden></div>
    </div>`);
  app.append(el);

  const canvas = el.querySelector<HTMLCanvasElement>('.canvas-wrap canvas')!;
  city = new CityRenderer(canvas, {
    onSelect(node) { state.selection = node; emit(); },
    onFocus(node) { state.focus = node; emit(); },
    onHover(node) { syncReadout(node); },
  });
  city.attachMinimap(el.querySelector<HTMLCanvasElement>('.minimap')!);
  city.setRoot(disk.root, true);
  runConstruction(el, disk);

  el.querySelector('.back')!.addEventListener('click', () => {
    if (state.focus && state.focus !== disk.root) {
      state.focus = state.focus.parent ?? disk.root;
      city!.flyTo(state.focus);
      emit();
    } else renderDisks();
  });
  el.querySelectorAll<HTMLElement>('.seg button').forEach(b =>
    b.addEventListener('click', () => {
      state.layer = b.dataset.layer as 'type' | 'age';
      el.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b));
      city!.invalidate(); emit();
    }));
  el.querySelector('.filters-btn')!.addEventListener('click', () => {
    const pop = el.querySelector<HTMLElement>('.filters-pop')!;
    pop.hidden = !pop.hidden;
    if (!pop.hidden) renderFiltersPop(pop);
  });
  el.querySelector('.search-open')!.addEventListener('click', openPalette);
  window.addEventListener('keydown', keyHandler);

  subscribe(syncChrome);
  syncChrome();
  syncReadout(null);
}

function runConstruction(el: HTMLElement, disk: Disk): void {
  const overlay = el.querySelector<HTMLElement>('.scan-overlay')!;
  const paths: string[] = [];
  const collect = (n: FsNode) => {
    if (paths.length > 300) return;
    if (!n.children) { if (Math.random() < 0.3) paths.push(nodePath(n)); return; }
    for (const c of n.children) collect(c);
  };
  collect(disk.root);

  const dur = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 2300;
  const t0 = performance.now();
  const pctEl = overlay.querySelector('.scan-pct')!;
  const fEl = overlay.querySelector('.s-files')!, bEl = overlay.querySelector('.s-bytes')!;
  const pathEl = overlay.querySelector('.scan-path')!;
  let lastPath = 0;

  const step = (now: number) => {
    const p = dur === 0 ? 1 : Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    city?.setBuild(e);
    pctEl.textContent = String(Math.round(e * 100));
    fEl.textContent = Math.round(e * disk.root.count).toLocaleString();
    bEl.textContent = fmtBytes(e * disk.root.size);
    if (now - lastPath > 80 && p < 1) {
      pathEl.textContent = paths[Math.floor(Math.random() * paths.length)] ?? '';
      lastPath = now;
    }
    if (p < 1) requestAnimationFrame(step);
    else {
      overlay.classList.add('done');
      el.querySelector('.hud')!.classList.add('ready');
      setTimeout(() => overlay.remove(), 700);
    }
  };
  requestAnimationFrame(step);
}

// ----------------------------------------------------------- key handling

function keyHandler(e: KeyboardEvent): void {
  if (state.screen !== 'map') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openPalette();
    return;
  }
  if (e.key === 'Escape') {
    const pal = document.querySelector<HTMLElement>('.palette');
    if (pal && !pal.hidden) { closePalette(); return; }
    state.selection = null;
    document.querySelector<HTMLElement>('.filters-pop')?.setAttribute('hidden', '');
    document.querySelector<HTMLElement>('.queue-panel')?.setAttribute('hidden', '');
    emit();
  }
}

// -------------------------------------------------------- command palette

function openPalette(): void {
  const pal = document.querySelector<HTMLElement>('.palette')!;
  pal.hidden = false;
  const input = pal.querySelector('input')!;
  input.value = state.query;
  input.focus();
  renderPaletteList(input.value);
  input.oninput = () => {
    state.query = input.value;
    recomputeVisibility(); city!.invalidate(); emit();
    renderPaletteList(input.value);
  };
  input.onkeydown = e => {
    if (e.key === 'Enter') {
      pal.querySelector<HTMLElement>('.pal-item')?.click();
    }
  };
  pal.onclick = e => { if (e.target === pal) closePalette(); };
}

function closePalette(): void {
  const pal = document.querySelector<HTMLElement>('.palette');
  if (pal) pal.hidden = true;
}

function clearQuery(): void {
  state.query = '';
  recomputeVisibility(); city?.invalidate(); emit();
}

function renderPaletteList(q: string): void {
  const list = document.querySelector<HTMLElement>('.pal-list')!;
  const query = q.trim().toLowerCase();

  if (!query) {
    list.innerHTML = `
      <div class="pal-hint">Type to light up matching buildings</div>
      <button class="pal-item" data-act="layer">${state.layer === 'type' ? 'Switch layer to Age heat' : 'Switch layer to Type'}</button>
      <button class="pal-item" data-act="big">Filter: buildings over 1 GB</button>
      <button class="pal-item" data-act="clear">Clear filters and search</button>
      <button class="pal-item" data-act="disks">Leave the city (disk select)</button>`;
    list.querySelectorAll<HTMLElement>('.pal-item').forEach(b =>
      b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (act === 'layer') {
          state.layer = state.layer === 'type' ? 'age' : 'type';
          document.querySelectorAll('.seg button').forEach(x =>
            x.classList.toggle('on', (x as HTMLElement).dataset.layer === state.layer));
        } else if (act === 'big') state.filters.minSize = GB;
        else if (act === 'clear') { state.filters = { minSize: 0, minAgeDays: 0, cats: new Set() }; state.query = ''; }
        else if (act === 'disks') { closePalette(); renderDisks(); return; }
        recomputeVisibility(); city!.invalidate(); emit();
        closePalette();
      }));
    return;
  }

  const matches = searchIndex
    .filter(e => e.l.includes(query) && e.n.kind !== 'rest')
    .sort((a, b) => b.n.size - a.n.size)
    .slice(0, 9);
  list.innerHTML = matches.length
    ? matches.map(m => `
        <button class="pal-item" data-id="${m.n.id}">
          <span class="pal-name">${catDot(m.n.cat)}${escapeHtml(m.n.name)}</span>
          <span class="pal-path">${escapeHtml(nodePath(m.n.parent ?? m.n))}</span>
          <span class="pal-size">${fmtBytes(m.n.size)}</span>
        </button>`).join('')
    : `<div class="pal-hint">No matches on this disk</div>`;
  list.querySelectorAll<HTMLElement>('.pal-item').forEach(b =>
    b.addEventListener('click', () => {
      const m = matches.find(x => x.n.id === Number(b.dataset.id))!;
      const target = m.n.kind === 'dir' ? m.n : m.n.parent!;
      state.selection = m.n;
      state.focus = target;
      city!.ensureLayout(target); // deep jumps need ancestor rects laid out
      closePalette();
      clearQuery();
      city!.flyTo(target);
      emit();
    }));
}

// -------------------------------------------------- giant kinetic readout

let readoutKey = '';
function syncReadout(hovered: FsNode | null): void {
  const el = app.querySelector('.readout');
  if (!el || !state.disk) return;
  const disk = state.disk;
  const n = hovered ?? state.selection ??
    (state.focus !== disk.root ? state.focus : null);
  const key = (n ? String(n.id) : 'disk') + state.layer + (filtersActive() ? 'f' : '');
  if (key === readoutKey) return;
  readoutKey = key;

  const name = el.querySelector<HTMLElement>('.r-name')!;
  const meta = el.querySelector<HTMLElement>('.r-meta')!;
  if (!n || n === disk.root) {
    name.textContent = `${disk.letter}: ${disk.label}`;
    meta.textContent = `${fmtBytes(disk.root.size)} used, ${disk.root.count.toLocaleString()} files` +
      (filtersActive() ? ', filtered' : '');
  } else {
    const share = (n.size / disk.root.size) * 100;
    name.textContent = n.kind === 'rest' ? 'Smaller items' : n.name;
    meta.textContent = `${fmtBytes(n.size)} · ${share < 0.01 ? '<0.01' : share.toFixed(share < 1 ? 2 : 1)}% of disk` +
      (n.kind === 'dir' ? `, ${n.count.toLocaleString()} files` : `, ${fmtAge(n.days)}`);
  }
  name.classList.remove('swap'); meta.classList.remove('swap');
  void name.offsetWidth;
  name.classList.add('swap'); meta.classList.add('swap');
}

// ------------------------------------------------------- chrome sync (map)

function syncChrome(): void {
  if (state.screen !== 'map') return;
  const disk = state.disk!;
  const el = app.querySelector('.map-screen')!;

  const crumbs = el.querySelector('.crumbs')!;
  const chain: FsNode[] = [];
  let cur: FsNode | null = state.focus ?? disk.root;
  while (cur) { chain.unshift(cur); cur = cur.parent; }
  crumbs.innerHTML = chain.map((n, i) =>
    `<button class="crumb ${i === chain.length - 1 ? 'cur' : ''}" data-i="${i}">${escapeHtml(n.name)}</button>`
  ).join('<span class="crumb-sep">›</span>');
  crumbs.querySelectorAll<HTMLElement>('.crumb').forEach(b =>
    b.addEventListener('click', () => {
      const n = chain[Number(b.dataset.i)];
      state.focus = n; city!.flyTo(n); emit();
    }));

  const badge = el.querySelector<HTMLElement>('.filters-btn .badge')!;
  const f = state.filters;
  const activeCount = (f.minSize ? 1 : 0) + (f.minAgeDays ? 1 : 0) + (f.cats.size ? 1 : 0);
  badge.hidden = activeCount === 0;
  badge.textContent = String(activeCount);

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

  readoutKey = '';
  syncReadout(null);
  syncDetails(el);
  syncQueue(el);
  city?.invalidate();
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
    <div class="d-kind">${catDot(n.cat)}${isDir ? 'District' : CAT_LABEL[n.cat]}</div>
    <div class="d-name">${escapeHtml(n.name)}</div>
    <div class="d-path">${escapeHtml(nodePath(n))}</div>
    <div class="d-grid">
      <div><b>${fmtBytes(n.size)}</b><span>size</span></div>
      <div><b>${share < 0.01 ? '<0.01' : share.toFixed(share < 1 ? 2 : 1)}%</b><span>of disk</span></div>
      <div><b>${isDir ? n.count.toLocaleString() : fmtAge(n.days)}</b><span>${isDir ? 'files' : 'modified'}</span></div>
    </div>
    ${childrenHtml}
    <div class="d-actions">
      ${isDir ? `<button class="btn d-zoom">Fly to district</button>` : ''}
      <button class="btn primary d-queue">${queued ? '✓ In cleanup queue' : 'Mark for cleanup'}</button>
      <button class="btn ghost d-open">Open in Explorer</button>
    </div>`;

  panel.querySelector('.d-close')!.addEventListener('click', () => { state.selection = null; emit(); });
  panel.querySelector('.d-zoom')?.addEventListener('click', () => { state.focus = n; city!.flyTo(n); emit(); });
  panel.querySelector('.d-queue')!.addEventListener('click', () => toggleQueue(n));
  panel.querySelector('.d-open')!.addEventListener('click', () => flashNote('Preview build. Explorer integration lands with the Rust backend.'));
  panel.querySelectorAll<HTMLElement>('.d-child').forEach(b =>
    b.addEventListener('click', () => {
      const c = n.children!.find(x => x.id === Number(b.dataset.id));
      if (c) {
        state.selection = c;
        state.focus = c.kind === 'dir' ? c : n;
        city!.flyTo(state.focus);
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
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
    <b>${state.queue.length}</b> marked, <b>${fmtBytes(queueTotal())}</b> reclaimable`;
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
    <div class="q-note">Safe by default: preview, confirm, Recycle Bin. Executed by the Rust backend.</div>`;
  panel.querySelectorAll<HTMLElement>('.q-x').forEach(b =>
    b.addEventListener('click', () => { state.queue.splice(Number(b.dataset.i), 1); emit(); }));
  panel.querySelector('.q-clear')!.addEventListener('click', () => { state.queue = []; emit(); });
  panel.querySelector('.q-run')!.addEventListener('click', () =>
    flashNote('Preview build. The deletion flow ships with the backend, recycle-bin first and always reviewable.'));
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
      recomputeVisibility(); city!.invalidate(); emit();
      renderFiltersPop(pop);
    }));
  pop.querySelector('.f-reset')!.addEventListener('click', () => {
    state.filters = { minSize: 0, minAgeDays: 0, cats: new Set() };
    recomputeVisibility(); city!.invalidate(); emit();
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
