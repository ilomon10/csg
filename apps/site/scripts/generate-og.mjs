// Generates static 1200x630 Open Graph PNGs for the landing page and every
// docs page (spec 010 REQ-WEB-038), and merges them into
// public/sprites/manifest.json (REQ-WEB-033). Uses the same placeholder sprite
// renderer as the landing page and a built-in 5x7 bitmap font: no network, no
// font files, deterministic output. Runs before `next build`.
//
// Files: public/og/default.png (landing) and public/og/docs/<slug>.png, where
// <slug> is the route under /docs/ ('index' for /docs/).
import console from 'node:console';
import process from 'node:process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {encodePng} from './sprites/png.mjs';
import {palette, renderPixelFrame} from './sprites/render.mjs';
import {
  drawText,
  fillRect,
  wrap,
  ADVANCE,
  GLYPH_H,
} from './sprites/font5x7.mjs';
import {routeForRepoPath} from '../lib/doc-routes.ts';

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(SITE, '../..');
const PUBLIC = join(SITE, 'public');
const W = 1200;
const H = 630;
const INK = [236, 236, 239];
const SOFT = [163, 167, 177];
const ACCENT = [235, 122, 62];
const BG = [16, 17, 20];
const BG_ALT = [27, 28, 33];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function titleOf(file) {
  const text = readFileSync(file, 'utf8');
  const fm = /^---\n([\s\S]*?)\n---/.exec(text);
  const fmTitle = fm && /^title:\s*(.+)$/m.exec(fm[1]);
  if (fmTitle) return fmTitle[1].replace(/^['"]|['"]$/g, '').trim();
  const h1 = /^#\s+(.+)$/m.exec(text);
  return h1 ? h1[1].trim() : 'Documentation';
}

function strip(title) {
  return title.replace(/[`*_]/g, '').replace(/\s+/g, ' ');
}

function newImage() {
  const img = {w: W, h: H, data: new Uint8ClampedArray(W * H * 4)};
  fillRect(img, 0, 0, W, H, BG);
  // Pixel checker floor strip for a game-tool feel.
  for (let x = 0; x < W; x += 30)
    for (let y = H - 30; y < H; y += 30)
      if (((x + y) / 30) % 2 === 0) fillRect(img, x, y, 30, 30, BG_ALT);
  fillRect(img, 0, 0, W, 12, ACCENT);
  return img;
}

function drawSprite(img, opts, x, y, scale) {
  const cell = 64;
  const tile = new Uint8ClampedArray(cell * cell * 4);
  renderPixelFrame({
    cell,
    scale: 1.2,
    pitch: 30,
    direction: 'SE',
    phase: 1,
    ...opts,
    out: tile,
    outW: cell,
  });
  for (let py = 0; py < cell; py++)
    for (let px = 0; px < cell; px++) {
      const k = (py * cell + px) * 4;
      if (tile[k + 3] === 0) continue;
      fillRect(img, x + px * scale, y + py * scale, scale, scale, [
        tile[k],
        tile[k + 1],
        tile[k + 2],
      ]);
    }
}

const PAL = palette();
const MAGE = palette({
  tunic: ['#7c6cc4', '#5a4b99', '#3c3170'],
  accent: ['#e9c46a', '#c99a3e', '#8c6622'],
  hair: ['#d9d3c7', '#aaa294', '#6f685d'],
});
const KNIGHT = palette({
  tunic: ['#a9b0bb', '#7b8391', '#4f5664'],
  accent: ['#d0503c', '#a53a2c', '#6c241c'],
  pants: ['#6d6f7a', '#4c4e58', '#33343c'],
});
const RANGER = palette({
  tunic: ['#6f9e5a', '#507a40', '#355229'],
  accent: ['#c9a25a', '#9c7a3c', '#644c22'],
  hair: ['#d9a24f', '#b07a32', '#714b1c'],
  skin: ['#c99a76', '#a2704f', '#6c4532'],
});
const ROGUE = palette({
  tunic: ['#4b4f5c', '#353843', '#23252d'],
  accent: ['#59b49a', '#3c8c74', '#25604f'],
  hair: ['#b8382f', '#8c2721', '#5c1814'],
});

/** Draws title lines, shrinking the pixel size until they fit `maxLines`. */
function drawTitle(img, title, x, y, maxWidth, maxLines) {
  for (const s of [10, 8, 6, 5, 4]) {
    const cols = Math.floor(maxWidth / (ADVANCE * s));
    const lines = wrap(title, cols);
    if (lines.length <= maxLines || s === 4) {
      const shown = lines.slice(0, maxLines);
      if (lines.length > maxLines) {
        const last = shown[maxLines - 1];
        shown[maxLines - 1] = last.slice(0, Math.max(0, cols - 3)) + '...';
      }
      shown.forEach((l, i) =>
        drawText(img, l, x, y + i * (GLYPH_H + 2) * s, s, INK),
      );
      return y + shown.length * (GLYPH_H + 2) * s;
    }
  }
  return y;
}

function landing() {
  const img = newImage();
  drawText(img, 'OPEN SOURCE - RUNS IN YOUR BROWSER', 60, 52, 4, ACCENT);
  const bottom = drawTitle(img, 'CHARACTER SPRITE GENERATOR', 60, 120, 1080, 2);
  drawText(
    img,
    'PIXEL-ART SPRITE SHEETS FROM 3D PARTS',
    60,
    bottom + 14,
    4,
    SOFT,
  );
  const row = [
    {pal: PAL, build: {backpack: true}},
    {pal: MAGE, build: {hat: 'wizard', scarf: false, cape: true}},
    {pal: KNIGHT, build: {hat: 'helm', cape: true, scarf: false}},
    {pal: RANGER, build: {backpack: true}},
    {pal: ROGUE, build: {cape: true, scarf: true}},
    {pal: PAL, build: {backpack: true}},
  ];
  const s = 3;
  const dirs = ['SE', 'S', 'SW', 'E', 'SE', 'S'];
  row.forEach((c, i) =>
    drawSprite(
      img,
      {...c, direction: dirs[i], phase: i},
      60 + i * 190,
      H - 30 - 64 * s + 2,
      s,
    ),
  );
  return {img, description: 'Landing page OG card, six characters in a row'};
}

function docs(title, section) {
  const img = newImage();
  drawText(img, 'CHARACTER SPRITE GENERATOR', 60, 52, 4, ACCENT);
  drawText(img, section.toUpperCase(), 60, 52 + 8 * 4 + 8, 4, SOFT);
  drawTitle(img, strip(title), 60, 190, 640, 4);
  const robot = section === 'Contribute';
  drawSprite(
    img,
    robot
      ? {
          build: {kind: 'robot', legs: 9, torso: 6.2, head: 1},
          pal: palette({accent: ['#f39345', '#d2672d', '#994221']}),
        }
      : {build: {backpack: true}, pal: PAL},
    760,
    H - 30 - 64 * 6 + 12,
    6,
  );
  return {img, description: `Docs OG card: ${strip(title)}`};
}

// ---------- collect pages ----------
const pages = [];
const add = (file, repoPath) => {
  const route = routeForRepoPath(repoPath);
  if (!route) return;
  const slug = route.replace(/^\/docs\//, '').replace(/\/$/, '') || 'index';
  const section = route.startsWith('/docs/contribute/')
    ? 'Contribute'
    : 'Guide';
  pages.push({file, slug, title: titleOf(file), section});
};
for (const dir of ['docs/guide', 'docs/contributing', 'docs/adr'])
  for (const f of walk(join(REPO, dir)))
    if (f.endsWith('.md')) add(f, relative(REPO, f).split(sep).join('/'));
add(join(REPO, 'docs/architecture.md'), 'docs/architecture.md');

// ---------- write ----------
rmSync(join(PUBLIC, 'og'), {recursive: true, force: true});
const items = [];
function emit(file, {img, description}) {
  const path = join(PUBLIC, file);
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, encodePng(W, H, img.data));
  items.push({
    file,
    width: W,
    height: H,
    appVersion: '0.0.0-placeholder',
    backend: 'webgl2',
    assets: [],
    placeholder: true,
    kind: 'og',
    description,
    renderSettings: {
      renderer: 'site-placeholder-sdf',
      font: 'builtin-5x7-bitmap',
      cell: 64,
    },
  });
}
emit('og/default.png', landing());
{
  // 64x64 favicon: the adventurer's head, so browsers never request /favicon.ico.
  const size = 64;
  const rgba = new Uint8ClampedArray(size * size * 4);
  renderPixelFrame({
    build: {backpack: true},
    pal: PAL,
    direction: 'S',
    pitch: 20,
    cell: size,
    scale: 3,
    target: [0, 36, 0],
    phase: 0,
    out: rgba,
    outW: size,
  });
  const path = join(PUBLIC, 'favicon.png');
  writeFileSync(path, encodePng(size, size, rgba));
  items.push({
    file: 'favicon.png',
    width: size,
    height: size,
    appVersion: '0.0.0-placeholder',
    backend: 'webgl2',
    assets: [],
    placeholder: true,
    kind: 'icon',
    description: 'Site icon: adventurer head, front view',
    renderSettings: {renderer: 'site-placeholder-sdf', cell: size},
  });
}
for (const p of pages) emit(`og/docs/${p.slug}.png`, docs(p.title, p.section));

// ---------- merge into the provenance manifest ----------
const manifestPath = join(PUBLIC, 'sprites/manifest.json');
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, 'utf8'))
  : {format: 'csg-site-sprites', version: 1, items: []};
manifest.items = [
  ...manifest.items.filter(
    i => !i.file.startsWith('og/') && i.file !== 'favicon.png',
  ),
  ...items,
];
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(
  `Wrote ${items.length} OG images and merged them into manifest.json`,
);
if (process.exitCode) process.exit(process.exitCode);
