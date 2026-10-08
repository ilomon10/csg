// Generates the ORIGINAL placeholder sprite art for the landing page and writes
// public/sprites/manifest.json (spec 010 REQ-WEB-033). Every entry is marked
// `placeholder: true`: these frames come from a tiny SDF stand-in renderer in
// scripts/sprites/render.mjs, not from the real export pipeline (spec 005).
// Production builds (SITE_ENV=production) refuse placeholders, see
// scripts/check-provenance.mjs. Output is deterministic (no clock, no RNG).
//
// Run: pnpm --filter @csg/site sprites
import console from 'node:console';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {encodePng} from './sprites/png.mjs';
import {
  DIRECTION_ORDER,
  palette,
  renderPixelFrame,
  renderSmooth,
} from './sprites/render.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const OUT = join(ROOT, 'sprites');
const FRAMES = 6;
const phaseOf = f => (f / FRAMES) * Math.PI * 2;

const HERO = {backpack: true};
const PAL = palette();
const items = [];

function write(file, w, h, rgba, meta) {
  const path = join(ROOT, file);
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, encodePng(w, h, rgba));
  items.push({
    file,
    width: w,
    height: h,
    appVersion: '0.0.0-placeholder',
    backend: 'webgl2',
    assets: [],
    placeholder: true,
    ...meta,
  });
}

/** Sheet with rows x FRAMES cells. rows: [{build, direction, pitch, pal, look}] */
function sheet(
  file,
  rows,
  {cell = 64, scale = 1.3, frames = FRAMES, desc, renderSettings = {}} = {},
) {
  const w = cell * frames;
  const h = cell * rows.length;
  const rgba = new Uint8ClampedArray(w * h * 4);
  rows.forEach((row, r) => {
    for (let f = 0; f < frames; f++) {
      renderPixelFrame({
        scale,
        cell,
        pal: PAL,
        ...row,
        phase: frames === 1 ? 0 : phaseOf(f),
        out: rgba,
        outW: w,
        ox: f * cell,
        oy: r * cell,
      });
    }
  });
  write(file, w, h, rgba, {
    kind: 'sheet',
    cell: {w: cell, h: cell},
    frames,
    rows: rows.map(r => r.label ?? r.direction),
    description: desc,
    renderSettings: {
      renderer: 'site-placeholder-sdf',
      cell,
      frames,
      ...renderSettings,
    },
  });
}

mkdirSync(OUT, {recursive: true});

// 1. Hero: 8-direction walk, 3/4 top-down camera, 64 px cells.
sheet(
  'sprites/hero/adventurer-walk-8dir.png',
  DIRECTION_ORDER.map(direction => ({build: HERO, direction, pitch: 30})),
  {
    desc: 'Adventurer walk cycle, 8 directions, 3/4 camera',
    renderSettings: {camera: 'top-down-3/4', pitch: 30},
  },
);

// 2. Camera styles: same character, side view vs 3/4 top-down.
sheet(
  'sprites/features/cameras.png',
  [
    {build: HERO, direction: 'E', pitch: 0, label: 'side'},
    {build: HERO, direction: 'SE', pitch: 35, label: 'top-down'},
  ],
  {
    desc: 'Side view and top-down 3/4 walk',
    renderSettings: {cameras: ['side', 'top-down-3/4']},
  },
);

// 3. Mix and match: outfits and palettes on one rig.
const lineup = [
  {label: 'scout', build: {backpack: true}, pal: PAL},
  {
    label: 'mage',
    build: {hat: 'wizard', scarf: false, cape: true},
    pal: palette({
      tunic: ['#7c6cc4', '#5a4b99', '#3c3170'],
      accent: ['#e9c46a', '#c99a3e', '#8c6622'],
      hair: ['#d9d3c7', '#aaa294', '#6f685d'],
    }),
  },
  {
    label: 'knight',
    build: {hat: 'helm', cape: true, scarf: false},
    pal: palette({
      tunic: ['#a9b0bb', '#7b8391', '#4f5664'],
      accent: ['#d0503c', '#a53a2c', '#6c241c'],
      pants: ['#6d6f7a', '#4c4e58', '#33343c'],
    }),
  },
  {
    label: 'ranger',
    build: {backpack: true},
    pal: palette({
      tunic: ['#6f9e5a', '#507a40', '#355229'],
      accent: ['#c9a25a', '#9c7a3c', '#644c22'],
      hair: ['#d9a24f', '#b07a32', '#714b1c'],
      skin: ['#c99a76', '#a2704f', '#6c4532'],
    }),
  },
  {
    label: 'bard',
    build: {hat: 'wizard', scarf: true},
    pal: palette({
      hat: ['#d76a5b', '#ad4a3e', '#743026'],
      tunic: ['#e0b04f', '#b98a33', '#7c5b1e'],
      accent: ['#5b8fbf', '#3f6894', '#2a4568'],
      skin: ['#8d5b40', '#6d412c', '#472619'],
      hair: ['#2c2421', '#1d1716', '#100c0b'],
    }),
  },
  {
    label: 'rogue',
    build: {cape: true, scarf: true},
    pal: palette({
      tunic: ['#4b4f5c', '#353843', '#23252d'],
      accent: ['#59b49a', '#3c8c74', '#25604f'],
      hair: ['#b8382f', '#8c2721', '#5c1814'],
    }),
  },
];
sheet(
  'sprites/features/lineup.png',
  lineup.map(v => ({
    build: v.build,
    pal: v.pal,
    direction: 'SE',
    pitch: 30,
    label: v.label,
  })),
  {scale: 1.05, desc: 'Six outfit and palette combinations on one rig'},
);

// 3b. Parade: the same six characters walking east, low 3/4 camera.
sheet(
  'sprites/parade/lineup-east.png',
  lineup.map(v => ({
    build: v.build,
    pal: v.pal,
    direction: 'E',
    pitch: 20,
    label: v.label,
  })),
  {scale: 1.05, desc: 'Six characters walking east'},
);

// 4. Anatomy: chibi, standard, tall.
sheet(
  'sprites/features/anatomy.png',
  [
    {
      build: {head: 1.12, legs: 7, torso: 5, backpack: true},
      direction: 'S',
      pitch: 25,
      label: 'chibi',
    },
    {
      build: {head: 0.9, legs: 10.5, torso: 6, backpack: true},
      direction: 'S',
      pitch: 25,
      label: 'standard',
    },
    {
      build: {head: 0.74, legs: 13.5, torso: 7, backpack: true},
      direction: 'S',
      pitch: 25,
      label: 'tall',
    },
  ],
  {
    scale: 1.05,
    desc: 'Three proportion presets',
    renderSettings: {anatomy: ['chibi', 'standard', 'tall']},
  },
);

// 5. Custom model: a boxy robot rig.
sheet(
  'sprites/features/robot.png',
  [
    {
      build: {kind: 'robot', legs: 9, torso: 6.2, head: 1},
      direction: 'SE',
      pitch: 30,
      label: 'robot',
      pal: palette({accent: ['#f39345', '#d2672d', '#994221']}),
    },
  ],
  {desc: 'Custom model walk cycle (boxy robot)'},
);

// 6. Looks: what the shader graph changes (single frames).
const looks = [
  {label: 'toon-outline', look: 'toon', outline: true, pal: PAL},
  {label: 'no-outline', look: 'toon', outline: false, pal: PAL},
  {label: 'dither', look: 'dither', outline: true, pal: PAL},
  {
    label: 'four-tone',
    look: 'toon',
    outline: true,
    pal: (() => {
      const g = ['#c4cfa1', '#8b956d', '#4d533c'];
      const p = palette();
      const mk = h => [
        parseInt(h.slice(1, 3), 16),
        parseInt(h.slice(3, 5), 16),
        parseInt(h.slice(5, 7), 16),
      ];
      for (const k of Object.keys(p))
        if (Array.isArray(p[k]) && Array.isArray(p[k][0])) p[k] = g.map(mk);
      p.eye = [mk('#1f1f1f'), mk('#1f1f1f'), mk('#1f1f1f')];
      p.outline = mk('#1f1f1f');
      return p;
    })(),
  },
];
{
  const cell = 64;
  const w = cell * looks.length;
  const rgba = new Uint8ClampedArray(w * cell * 4);
  looks.forEach((l, i) =>
    renderPixelFrame({
      build: HERO,
      direction: 'SE',
      pitch: 30,
      scale: 1.2,
      cell,
      ...l,
      phase: phaseOf(1),
      out: rgba,
      outW: w,
      ox: i * cell,
      oy: 0,
    }),
  );
  write('sprites/features/looks.png', w, cell, rgba, {
    kind: 'sheet',
    cell: {w: cell, h: cell},
    frames: looks.length,
    rows: ['looks'],
    description:
      'Four looks from one character: toon + outline, no outline, Bayer dither, four-tone palette',
    renderSettings: {
      renderer: 'site-placeholder-sdf',
      looks: looks.map(l => l.label),
    },
  });
}

// 7. Small 32 px export sheet (4 directions) for the export feature.
sheet(
  'sprites/features/export-32.png',
  ['S', 'W', 'N', 'E'].map(direction => ({build: HERO, direction, pitch: 30})),
  {
    cell: 32,
    scale: 0.6,
    desc: '32 px sheet, 4 directions, 6 frames',
    renderSettings: {cell: 32},
  },
);

// 8. "How it works" stills.
{
  // Exploded 3D parts (smooth).
  const s = 256;
  const rgba = new Uint8ClampedArray(s * s * 4);
  renderSmooth({
    build: {...HERO, explode: 1},
    direction: 'SE',
    pitch: 18,
    size: s,
    scale: 3.6,
    pal: PAL,
    target: [0, 21, 0],
    out: rgba,
    outW: s,
  });
  write('sprites/how/parts.png', s, s, rgba, {
    kind: 'frame',
    description: 'Exploded modular parts, smooth shaded',
    renderSettings: {
      renderer: 'site-placeholder-sdf',
      shading: 'smooth',
      explode: true,
    },
  });
}
{
  // Anatomy: three proportions, smooth.
  const s = 256;
  const w = s;
  const rgba = new Uint8ClampedArray(w * s * 4);
  const builds = [
    {head: 1.12, legs: 7, torso: 5},
    {head: 0.9, legs: 10.5, torso: 6},
    {head: 0.74, legs: 13.5, torso: 7},
  ];
  // Render each figure into its own tile then composite left to right.
  builds.forEach((b, i) => {
    const tile = new Uint8ClampedArray(s * s * 4);
    renderSmooth({
      build: {...b, backpack: true},
      direction: 'S',
      pitch: 14,
      size: s,
      scale: 3.6,
      pal: PAL,
      target: [0, 25, 0],
      out: tile,
      outW: s,
    });
    const shift = (i - 1) * 78;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const tx = x - shift;
        if (tx < 0 || tx >= s) continue;
        const a = (y * s + tx) * 4;
        if (tile[a + 3] === 0) continue;
        const k = (y * w + x) * 4;
        const al = tile[a + 3] / 255;
        for (let c = 0; c < 3; c++)
          rgba[k + c] = Math.round(tile[a + c] * al + rgba[k + c] * (1 - al));
        rgba[k + 3] = Math.max(rgba[k + 3], tile[a + 3]);
      }
    }
  });
  write('sprites/how/anatomy.png', w, s, rgba, {
    kind: 'frame',
    description: 'Chibi, standard and tall proportions, smooth shaded',
    renderSettings: {renderer: 'site-placeholder-sdf', shading: 'smooth'},
  });
}
{
  // Shader: left half smooth, right half the 64 px pixel frame scaled x4.
  const s = 256;
  const smooth = new Uint8ClampedArray(s * s * 4);
  renderSmooth({
    build: HERO,
    direction: 'SE',
    pitch: 30,
    size: s,
    scale: 4.8,
    pal: PAL,
    target: [0, 20, 0],
    out: smooth,
    outW: s,
  });
  const px = new Uint8ClampedArray(64 * 64 * 4);
  renderPixelFrame({
    build: HERO,
    direction: 'SE',
    pitch: 30,
    cell: 64,
    scale: 1.2,
    pal: PAL,
    out: px,
    outW: 64,
  });
  const rgba = new Uint8ClampedArray(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const k = (y * s + x) * 4;
      const src = x < s / 2 ? smooth : px;
      const i = x < s / 2 ? k : ((y >> 2) * 64 + (x >> 2)) * 4;
      for (let c = 0; c < 4; c++) rgba[k + c] = src[i + c];
    }
  }
  write('sprites/how/shader.png', s, s, rgba, {
    kind: 'frame',
    description: 'Same pose before and after the pixel pass (64 px, shown x4)',
    renderSettings: {renderer: 'site-placeholder-sdf', cell: 64},
  });
}

// Keep the OG card entries that scripts/generate-og.mjs merged in earlier.
const previous = existsSync(join(OUT, 'manifest.json'))
  ? JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8')).items
  : [];
items.push(
  ...previous.filter(i => i.file.startsWith('og/') || i.file === 'favicon.png'),
);
writeFileSync(
  join(OUT, 'manifest.json'),
  JSON.stringify({format: 'csg-site-sprites', version: 1, items}, null, 2) +
    '\n',
);
console.log(
  `Wrote ${items.length} placeholder images and sprites/manifest.json`,
);
