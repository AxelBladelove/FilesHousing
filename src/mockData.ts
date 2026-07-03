import type { Cat, Disk, FsNode } from './types';

// Deterministic RNG so the map is stable across reloads.
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(0xf11e5);

const GB = 1024 ** 3;
const MB = 1024 ** 2;

let nextId = 1;

function file(name: string, size: number, cat: Cat, days: number): FsNode {
  return { id: nextId++, name, kind: 'file', cat, size, days, count: 1, parent: null };
}

function dir(name: string, children: FsNode[], cat: Cat = 'other'): FsNode {
  return { id: nextId++, name, kind: 'dir', cat, size: 0, days: 9999, count: 0, parent: null, children };
}

/** Generate `n` files summing roughly `total`, pareto-ish size distribution. */
function spread(
  n: number, total: number, cat: Cat, ext: string,
  stem: string, ageMin: number, ageMax: number,
): FsNode[] {
  const weights: number[] = [];
  let wsum = 0;
  for (let i = 0; i < n; i++) { const w = 1 / Math.pow(i + 1, 0.9 + rnd() * 0.5); weights.push(w); wsum += w; }
  const out: FsNode[] = [];
  for (let i = 0; i < n; i++) {
    const size = Math.max(1024, Math.round((weights[i] / wsum) * total * (0.7 + rnd() * 0.6)));
    const days = ageMin + rnd() * (ageMax - ageMin);
    out.push(file(`${stem}_${String(i + 1).padStart(2, '0')}${ext}`, size, cat, days));
  }
  return out;
}

function project(name: string, code: number, deps: number, days: number): FsNode {
  return dir(name, [
    dir('node_modules', spread(40, deps, 'code', '', 'pkg', days, days + 400), 'code'),
    dir('src', spread(24, code, 'code', '.ts', 'module', days, days + 120), 'code'),
    dir('.git', spread(10, code * 0.8, 'data', '.pack', 'objects', days, days + 300), 'data'),
    dir('dist', spread(8, code * 0.5, 'code', '.js', 'bundle', days, days + 60), 'code'),
    file('package-lock.json', 2.1 * MB, 'doc', days),
  ], 'code');
}

function buildC(): FsNode {
  const root = dir('C:', [
    dir('Windows', [
      dir('WinSxS', spread(60, 9.4 * GB, 'system', '.dll', 'amd64_component', 200, 1400), 'system'),
      dir('System32', spread(70, 7.8 * GB, 'system', '.dll', 'sys', 100, 1400), 'system'),
      dir('Installer', spread(24, 4.6 * GB, 'system', '.msi', 'setup', 90, 1100), 'system'),
      dir('SoftwareDistribution', spread(18, 2.8 * GB, 'system', '.cab', 'update', 5, 200), 'system'),
      dir('Temp', spread(30, 1.9 * GB, 'system', '.tmp', 'tmp', 0, 90), 'system'),
      dir('Fonts', spread(28, 0.9 * GB, 'system', '.ttf', 'font', 400, 1400), 'system'),
    ], 'system'),
    dir('Program Files', [
      dir('Adobe', [
        dir('Premiere Pro', spread(20, 7.8 * GB, 'app', '.dll', 'plugin', 120, 500), 'app'),
        dir('Photoshop', spread(18, 4.5 * GB, 'app', '.dll', 'lib', 120, 500), 'app'),
      ], 'app'),
      dir('JetBrains', spread(26, 5.2 * GB, 'app', '.jar', 'lib', 60, 300), 'app'),
      dir('Microsoft Office', spread(24, 4.1 * GB, 'app', '.dll', 'office', 200, 700), 'app'),
      dir('OBS Studio', spread(14, 1.2 * GB, 'app', '.dll', 'obs', 90, 400), 'app'),
      dir('Blender Foundation', spread(12, 2.6 * GB, 'app', '.dll', 'blender', 150, 420), 'app'),
      dir('NVIDIA Corporation', spread(16, 2.2 * GB, 'app', '.dll', 'nv', 30, 300), 'app'),
    ], 'app'),
    dir('Program Files (x86)', [
      dir('Steam', [
        dir('steamapps', [
          dir('Cyberpunk 2077', spread(18, 62 * GB, 'game', '.archive', 'basegame', 180, 400), 'game'),
          dir('Baldurs Gate 3', spread(16, 48 * GB, 'game', '.pak', 'gustav', 90, 300), 'game'),
          dir('Red Dead Redemption 2', spread(14, 44 * GB, 'game', '.rpf', 'world', 400, 800), 'game'),
          dir('Elden Ring', spread(12, 33 * GB, 'game', '.bdt', 'data', 300, 700), 'game'),
          dir('Hades II', spread(10, 9 * GB, 'game', '.pkg', 'content', 30, 120), 'game'),
        ], 'game'),
        dir('shader_cache', spread(20, 6 * GB, 'data', '.bin', 'shader', 5, 200), 'data'),
      ], 'game'),
      spreadDir('Common Files', 20, 3.2 * GB, 'app', '.dll', 'shared', 200, 900),
    ], 'game'),
    dir('Users', [
      dir('axel', [
        dir('Videos', [
          dir('OBS Recordings', spread(22, 96 * GB, 'video', '.mkv', 'replay_2025-', 10, 500), 'video'),
          dir('Exports', spread(9, 21 * GB, 'video', '.mp4', 'final_v', 30, 400), 'video'),
        ], 'video'),
        dir('Downloads', [
          file('Win11_23H2_ISO.iso', 6.4 * GB, 'archive', 340),
          file('DaVinci_Resolve_Setup.exe', 3.9 * GB, 'app', 210),
          file('dataset_dump_2024.zip', 5.8 * GB, 'archive', 480),
          ...spread(26, 14 * GB, 'archive', '.zip', 'download', 5, 700),
          ...spread(18, 7 * GB, 'app', '.exe', 'installer', 10, 600),
        ], 'archive'),
        dir('Projects', [
          project('fileshousing', 300 * MB, 1.4 * GB, 2),
          project('portfolio-site', 120 * MB, 0.9 * GB, 90),
          project('game-jam-2025', 900 * MB, 1.8 * GB, 260),
          project('scraper-suite', 200 * MB, 1.1 * GB, 150),
          dir('assets', spread(30, 18 * GB, 'image', '.psd', 'artboard', 30, 500), 'image'),
          dir('renders', spread(12, 26 * GB, 'video', '.mov', 'render', 20, 300), 'video'),
        ], 'code'),
        dir('AppData', [
          dir('Local', [
            spreadDir('Google Chrome', 30, 4.8 * GB, 'data', '.ldb', 'profile', 0, 300),
            spreadDir('Discord', 16, 2.1 * GB, 'data', '.blob', 'cache', 0, 200),
            spreadDir('Spotify', 14, 3.4 * GB, 'data', '.file', 'storage', 0, 150),
            spreadDir('npm-cache', 40, 3.8 * GB, 'code', '.tgz', 'pkg', 30, 600),
            spreadDir('pip', 24, 1.9 * GB, 'code', '.whl', 'wheel', 60, 500),
            spreadDir('Temp', 34, 2.6 * GB, 'system', '.tmp', 'wer', 0, 120),
          ], 'data'),
          spreadDir('Roaming', 26, 3.1 * GB, 'data', '.dat', 'app', 10, 400),
        ], 'data'),
        dir('Pictures', [
          spreadDir('Camera Roll', 40, 14 * GB, 'image', '.jpg', 'IMG_2', 100, 900),
          spreadDir('Screenshots', 30, 3.2 * GB, 'image', '.png', 'shot', 0, 400),
          spreadDir('Wallpapers', 16, 1.1 * GB, 'image', '.png', 'wall', 200, 900),
        ], 'image'),
        spreadDir('Documents', 34, 6.8 * GB, 'doc', '.pdf', 'doc', 30, 800),
        spreadDir('Music', 30, 8.9 * GB, 'audio', '.flac', 'track', 100, 1000),
        spreadDir('Desktop', 18, 3.4 * GB, 'other', '', 'item', 0, 300),
      ], 'other'),
    ], 'other'),
    spreadDir('ProgramData', 30, 9.6 * GB, 'system', '.dat', 'vendor', 60, 700),
    file('pagefile.sys', 12.9 * GB, 'system', 0),
    file('hiberfil.sys', 6.4 * GB, 'system', 0),
  ], 'other');
  return root;
}

function spreadDir(
  name: string, n: number, total: number, cat: Cat,
  ext: string, stem: string, a0: number, a1: number,
): FsNode {
  return dir(name, spread(n, total, cat, ext, stem, a0, a1), cat);
}

function buildD(): FsNode {
  return dir('D:', [
    dir('Media', [
      spreadDir('Series', 34, 310 * GB, 'video', '.mkv', 'episode_s01e', 100, 900),
      spreadDir('Movies', 22, 180 * GB, 'video', '.mkv', 'film', 60, 1100),
      spreadDir('Raw Footage', 18, 88 * GB, 'video', '.braw', 'clip', 20, 400),
    ], 'video'),
    dir('Backups', [
      file('system_image_2024.vhdx', 96 * GB, 'archive', 540),
      file('phone_backup_full.zip', 38 * GB, 'archive', 300),
      ...spread(14, 64 * GB, 'archive', '.7z', 'backup', 90, 900),
    ], 'archive'),
    spreadDir('Game Library', 12, 140 * GB, 'game', '.pak', 'gamedata', 60, 600),
    spreadDir('Datasets', 20, 52 * GB, 'data', '.parquet', 'shard', 120, 700),
    spreadDir('Photo Archive', 40, 46 * GB, 'image', '.raw', 'DSC0', 300, 1600),
  ], 'video');
}

/** Post-pass: wire parents, aggregate sizes/counts/ages, pick dominant category. */
function finalize(node: FsNode, parent: FsNode | null): void {
  node.parent = parent;
  if (!node.children) return;
  let size = 0, count = 0, days = Infinity;
  const bycat = new Map<Cat, number>();
  for (const c of node.children) {
    finalize(c, node);
    size += c.size; count += c.count; days = Math.min(days, c.days);
    bycat.set(c.cat, (bycat.get(c.cat) ?? 0) + c.size);
  }
  node.size = size; node.count = count; node.days = days === Infinity ? 0 : days;
  let best: Cat = 'other', bestv = -1;
  for (const [k, v] of bycat) if (v > bestv) { best = k; bestv = v; }
  node.cat = best;
  node.children.sort((a, b) => b.size - a.size);
}

/** Merge single-child dir chains (Users → axel becomes "Users\axel"). */
function collapseChains(node: FsNode): void {
  let kids = node.children;
  if (!kids) return;
  while (kids.length === 1 && kids[0].kind === 'dir' && node.parent) {
    const only: FsNode = kids[0];
    node.name = `${node.name}\\${only.name}`;
    kids = only.children ?? [];
    node.children = kids;
    for (const c of kids) c.parent = node;
  }
  for (const c of kids) collapseChains(c);
}

export function buildDisks(): Disk[] {
  const c = buildC(); finalize(c, null); collapseChains(c);
  const d = buildD(); finalize(d, null); collapseChains(d);
  return [
    { letter: 'C', label: 'System', totalBytes: 931 * GB, root: c },
    { letter: 'D', label: 'Data', totalBytes: 1863 * GB, root: d },
  ];
}
