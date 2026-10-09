import {asepriteSheetSchema, exportManifestSchema} from '@csg/parts-schema';
import {describe, expect, it} from 'vitest';
import {buildCreditsTxt, licenseWarnings} from './credits';
import {ExportError} from './errors';
import {exportSpriteSheet} from './export-sprite-sheet';
import {sanitizeBaseName} from './naming';
import {planExport} from './plan';
import type {ClipSpec} from './test-fixtures';
import {
  CC0,
  CC_BY,
  makeContext,
  makeFrame,
  makeFrames,
  renderSettings,
  settings,
} from './test-fixtures';
import {crop, parsePng, readZip, sha256, text} from './test-helpers';
import type {SpriteExportManifest} from './types';

const CLIPS: ClipSpec[] = [
  {label: 'idle', frames: 4},
  {label: 'walk', frames: 8},
];

async function run(
  over: Parameters<typeof settings>[0] = {},
  clips = CLIPS,
  directions: 1 | 2 | 4 | 8 = 2,
  size = 4,
) {
  const render = renderSettings(clips, directions, 32);
  const frames = makeFrames(clips, directions, size, size);
  const res = await exportSpriteSheet(
    frames,
    settings(over),
    makeContext(render),
  );
  if (!res.ok) throw new Error(res.error.message);
  return {frames, render, ...res.value, zipFiles: readZip(res.value.zip)};
}

const manifestOf = (zip: Record<string, Uint8Array>, base: string) =>
  JSON.parse(text(zip[`${base}.manifest.json`])) as SpriteExportManifest;

describe('naming (REQ-EXP-016, REQ-EXP-012)', () => {
  it('AC-EXP-016.1: sanitizes the character name', () => {
    expect(sanitizeBaseName('Sir Knight #2 (blue)')).toBe('sir-knight-2-blue');
  });
  it('AC-EXP-016.2: falls back to character', () => {
    expect(sanitizeBaseName('???')).toBe('character');
    expect(sanitizeBaseName('騎士')).toBe('character');
    expect(sanitizeBaseName('a'.repeat(100))).toHaveLength(64);
  });
});

describe('layout (REQ-EXP-001..006)', () => {
  it('AC-EXP-001.1: frames delivered out of order are sorted clip, direction, frame', async () => {
    const render = renderSettings(CLIPS, 2, 32);
    const frames = makeFrames(CLIPS, 2, 4, 4).reverse();
    const res = await exportSpriteSheet(
      frames,
      settings(),
      makeContext(render),
    );
    if (!res.ok) throw new Error('failed');
    const m = manifestOf(readZip(res.value.zip), 'sir-knight-2-blue');
    expect(m.frames[0]?.name).toBe('idle_e_000');
    expect(m.frames[4]?.name).toBe('idle_w_000');
    expect(m.frames[8]?.name).toBe('walk_e_000');
    expect(m.frames).toHaveLength(2 * 4 + 2 * 8);
  });

  it('AC-EXP-001.2: a frame of another size fails with EXP_FRAME_SIZE_MISMATCH', async () => {
    const render = renderSettings([{label: 'idle', frames: 1}], 1, 32);
    const frames = [
      makeFrame('idle', 0, 0, 4, 4),
      makeFrame('idle', 0, 1, 3, 4),
    ];
    const res = await exportSpriteSheet(
      frames,
      settings(),
      makeContext(render),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('EXP_FRAME_SIZE_MISMATCH');
  });

  it('AC-EXP-002.1: each cell equals its input frame byte for byte', async () => {
    const out = await run();
    const sheet = parsePng(
      out.zipFiles['sir-knight-2-blue.png'] ?? new Uint8Array(),
    );
    const m = manifestOf(out.zipFiles, 'sir-knight-2-blue');
    for (const [i, f] of out.frames.entries()) {
      const r = m.frames[i]?.rect;
      if (r === undefined) throw new Error('rect');
      expect([...crop(sheet.rgba, sheet.width, r.x, r.y, r.w, r.h)]).toEqual([
        ...f.pixels,
      ]);
    }
  });

  it('AC-EXP-002.2: padding and margin pixels are transparent black', async () => {
    const out = await run({paddingPx: 2, marginPx: 1});
    const sheet = parsePng(
      out.zipFiles['sir-knight-2-blue.png'] ?? new Uint8Array(),
    );
    // Pixel (4, 0) is margin row; (5, 1) lies in the padding between cell 0 and 1.
    const px = (x: number, y: number) => [
      ...sheet.rgba.subarray(
        (y * sheet.width + x) * 4,
        (y * sheet.width + x) * 4 + 4,
      ),
    ];
    expect(px(0, 0)).toEqual([0, 0, 0, 0]);
    expect(px(1 + 4, 1)).toEqual([0, 0, 0, 0]);
    expect(px(1 + 4 + 1, 1 + 3)).toEqual([0, 0, 0, 0]);
  });

  it('AC-EXP-003.1: 8 directions, 64 px, idle 4 and walk 8 give a 512x1024 sheet', async () => {
    const render = renderSettings(CLIPS, 8, 64);
    const frames = makeFrames(CLIPS, 8, 64, 64);
    const res = await exportSpriteSheet(
      frames,
      settings(),
      makeContext(render),
    );
    if (!res.ok) throw new Error(res.error.message);
    const zip = readZip(res.value.zip);
    const sheet = parsePng(zip['sir-knight-2-blue.png'] ?? new Uint8Array());
    expect([sheet.width, sheet.height]).toEqual([512, 1024]);
    const m = manifestOf(zip, 'sir-knight-2-blue');
    const rowOf = (name: string) =>
      (m.frames.find(f => f.name === name)?.rect.y ?? -1) / 64;
    expect(rowOf('idle_e_000')).toBe(0);
    expect(rowOf('walk_e_000')).toBe(8);
    // Cells 4..7 of an idle row are transparent.
    const empty = crop(sheet.rgba, 512, 4 * 64, 0, 64, 64);
    expect(empty.every(b => b === 0)).toBe(true);
  });

  it('AC-EXP-003.2: direction-major puts walk/e on row 1', async () => {
    const out = await run({rowOrder: 'direction-major'});
    const m = manifestOf(out.zipFiles, 'sir-knight-2-blue');
    expect(m.frames.find(f => f.name === 'idle_e_000')?.rect.y).toBe(0);
    expect(m.frames.find(f => f.name === 'walk_e_000')?.rect.y).toBe(4);
  });

  it('AC-EXP-004.1: maxColumns 3 wraps an 8-frame clip onto 3 rows', async () => {
    const clips = [{label: 'walk', frames: 8}];
    const out = await run({maxColumns: 3}, clips, 1);
    const sheet = parsePng(
      out.zipFiles['sir-knight-2-blue.png'] ?? new Uint8Array(),
    );
    expect([sheet.width, sheet.height]).toEqual([12, 12]);
    const m = manifestOf(out.zipFiles, 'sir-knight-2-blue');
    expect(m.frames.map(f => [f.rect.x / 4, f.rect.y / 4])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
      [0, 2],
      [1, 2],
    ]);
  });

  it('AC-EXP-004.1: two (clip, direction) pairs never share a row', async () => {
    const out = await run({maxColumns: 3}, [{label: 'idle', frames: 2}], 2);
    const m = manifestOf(out.zipFiles, 'sir-knight-2-blue');
    expect(m.frames.map(f => f.rect.y / 4)).toEqual([0, 0, 1, 1]);
  });

  it('AC-EXP-005.1: strip-per-animation writes one PNG per clip with a row per direction', async () => {
    const out = await run({layout: 'strip-per-animation'}, [
      ...CLIPS,
      {label: 'run', frames: 6},
    ]);
    const names = out.files.map(f => f.name).filter(n => n.endsWith('.png'));
    expect(names).toEqual([
      'sir-knight-2-blue_idle.png',
      'sir-knight-2-blue_run.png',
      'sir-knight-2-blue_walk.png',
    ]);
    const walk = parsePng(
      out.zipFiles['sir-knight-2-blue_walk.png'] ?? new Uint8Array(),
    );
    expect([walk.width, walk.height]).toEqual([8 * 4, 2 * 4]);
    expect(out.files.some(f => f.name === 'sir-knight-2-blue_walk.json')).toBe(
      true,
    );
  });

  it('AC-EXP-006.1: 4 columns of 32 px, padding 2, margin 1 give 136 px wide, cell 1 at x 35', async () => {
    const clips = [{label: 'idle', frames: 4}];
    const render = renderSettings(clips, 1, 32);
    const frames = makeFrames(clips, 1, 32, 32);
    const res = await exportSpriteSheet(
      frames,
      settings({paddingPx: 2, marginPx: 1}),
      makeContext(render),
    );
    if (!res.ok) throw new Error(res.error.message);
    const zip = readZip(res.value.zip);
    expect(
      parsePng(zip['sir-knight-2-blue.png'] ?? new Uint8Array()).width,
    ).toBe(136);
    expect(manifestOf(zip, 'sir-knight-2-blue').frames[1]?.rect.x).toBe(35);
  });

  it('AC-EXP-007.1: power of two extends right and bottom without moving cells', async () => {
    const clips = [{label: 'idle', frames: 4}];
    const render = renderSettings(clips, 1, 32);
    const frames = makeFrames(clips, 1, 34, 20);
    const base = await exportSpriteSheet(
      frames,
      settings(),
      makeContext(render),
    );
    const pot = await exportSpriteSheet(
      frames,
      settings({powerOfTwo: true}),
      makeContext(render),
    );
    if (!base.ok || !pot.ok) throw new Error('failed');
    const a = parsePng(
      readZip(base.value.zip)['sir-knight-2-blue.png'] ?? new Uint8Array(),
    );
    const b = parsePng(
      readZip(pot.value.zip)['sir-knight-2-blue.png'] ?? new Uint8Array(),
    );
    expect([a.width, a.height]).toEqual([136, 20]);
    expect([b.width, b.height]).toEqual([256, 32]);
    expect([...crop(b.rgba, 256, 0, 0, 136, 20)]).toEqual([...a.rgba]);
    expect(
      manifestOf(readZip(pot.value.zip), 'sir-knight-2-blue').frames[1]?.rect,
    ).toEqual(
      manifestOf(readZip(base.value.zip), 'sir-knight-2-blue').frames[1]?.rect,
    );
  });
});

describe('scales (REQ-EXP-009)', () => {
  it('AC-EXP-009.1: 2x and 4x sheets replicate each pixel; padding and margin scale', async () => {
    const out = await run({scales: [1, 2, 4], paddingPx: 1, marginPx: 1});
    const get = (n: string) => parsePng(out.zipFiles[n] ?? new Uint8Array());
    const s1 = get('sir-knight-2-blue.png');
    for (const s of [2, 4]) {
      const sn = get(`sir-knight-2-blue@${s}x.png`);
      expect([sn.width, sn.height]).toEqual([s1.width * s, s1.height * s]);
      for (const [x, y] of [
        [1, 1],
        [5, 1],
        [3, 7],
        [0, 0],
      ] as const) {
        const want = s1.rgba.subarray(
          (y * s1.width + x) * 4,
          (y * s1.width + x) * 4 + 4,
        );
        for (const [dx, dy] of [
          [0, 0],
          [s - 1, s - 1],
          [s - 1, 0],
        ] as const) {
          const i = ((y * s + dy) * sn.width + x * s + dx) * 4;
          expect([...sn.rgba.subarray(i, i + 4)]).toEqual([...want]);
        }
      }
    }
  });

  it('AC-EXP-009.2: empty scales fail with EXP_INVALID_SETTINGS', async () => {
    const render = renderSettings([{label: 'idle', frames: 1}], 1, 32);
    const res = await exportSpriteSheet(
      [makeFrame('idle', 0, 0, 4, 4)],
      settings({scales: []}),
      makeContext(render),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('EXP_INVALID_SETTINGS');
  });

  it('refuses P2/P3 options this build does not write', async () => {
    const render = renderSettings([{label: 'idle', frames: 1}], 1, 32);
    const res = await exportSpriteSheet(
      [makeFrame('idle', 0, 0, 4, 4)],
      settings({pngColorType: 'indexed'}),
      makeContext(render),
    );
    expect(res.ok).toBe(false);
  });
});

describe('metadata (REQ-EXP-010..012)', () => {
  it('AC-EXP-010.2: duration is round(1000 / fps) and tags are contiguous', async () => {
    const out = await run();
    const json = JSON.parse(text(out.zipFiles['sir-knight-2-blue.json'])) as {
      frames: Array<{filename: string; duration: number}>;
      meta: {
        format: string;
        scale: string;
        image: string;
        size: {w: number; h: number};
        frameTags: Array<{
          name: string;
          from: number;
          to: number;
          direction: string;
        }>;
      };
    };
    const parsed = asepriteSheetSchema.safeParse(json);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(json.frames.every(f => f.duration === 83)).toBe(true);
    expect(json.meta.format).toBe('RGBA8888');
    expect(json.meta.scale).toBe('1');
    expect(json.meta.image).toBe('sir-knight-2-blue.png');
    expect(json.meta.frameTags).toHaveLength(4);
    expect(json.meta.frameTags[0]).toEqual({
      name: 'idle_e',
      from: 0,
      to: 3,
      direction: 'forward',
    });
    expect(json.meta.frameTags[1]).toEqual({
      name: 'idle_w',
      from: 4,
      to: 7,
      direction: 'forward',
    });
    expect(json.frames[8]?.filename).toBe('walk_e_000');
  });

  it('AC-EXP-010.3: loop is recorded in the manifest, tags stay forward', async () => {
    const out = await run({}, [
      {label: 'idle', frames: 2, loop: true},
      {label: 'attack', frames: 2, loop: false},
    ]);
    const m = manifestOf(out.zipFiles, 'sir-knight-2-blue');
    expect(m.clips.map(c => [c.label, c.loop, c.direction])).toEqual([
      ['idle', true, 'forward'],
      ['attack', false, 'forward'],
    ]);
  });

  it('AC-EXP-010.4: pingPong without baking tags pingpong; baked frames are forward', async () => {
    const a = await run({}, [{label: 'walk', frames: 5, pingPong: true}], 1);
    const tagsA = JSON.parse(text(a.zipFiles['sir-knight-2-blue.json'])) as {
      meta: {frameTags: Array<{direction: string; to: number}>};
    };
    expect(asepriteSheetSchema.safeParse(tagsA).success).toBe(true);
    expect(tagsA.meta.frameTags[0]?.direction).toBe('pingpong');
    expect(
      manifestOf(a.zipFiles, 'sir-knight-2-blue').clips[0]?.direction,
    ).toBe('pingpong');
    const b = await run(
      {},
      [{label: 'walk', frames: 5, pingPong: true, bakePingPong: true}],
      1,
    );
    const tagsB = JSON.parse(
      text(b.zipFiles['sir-knight-2-blue.json']),
    ) as typeof tagsA;
    expect(asepriteSheetSchema.safeParse(tagsB).success).toBe(true);
    expect(tagsB.meta.frameTags[0]).toMatchObject({
      direction: 'forward',
      to: 7,
    });
    expect(
      manifestOf(b.zipFiles, 'sir-knight-2-blue').clips[0]?.frameCount,
    ).toBe(8);
  });

  it('AC-EXP-011.1: the manifest has the contract shape and one entry per frame', async () => {
    const out = await run({scales: [1, 2]});
    const m = manifestOf(out.zipFiles, 'sir-knight-2-blue');
    expect(Object.keys(m)).toEqual([
      'format',
      'version',
      'source',
      'cell',
      'pivotPx',
      'directions',
      'scales',
      'sheets',
      'clips',
      'frames',
      'warnings',
    ]);
    const parsed = exportManifestSchema.safeParse(m);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(m.format).toBe('sprite-export-manifest');
    expect(m.version).toBe(1);
    expect(m.frames).toHaveLength(out.frames.length);
    expect(m.sheets.map(s => [s.file, s.scale])).toEqual([
      ['sir-knight-2-blue.png', 1],
      ['sir-knight-2-blue@2x.png', 2],
    ]);
    expect(m.source.projectSha256).toBe('a'.repeat(64));
    expect(m.directions).toEqual(['e', 'w']);
    expect(m.frames[0]).toMatchObject({
      name: 'idle_e_000',
      label: 'idle',
      direction: 'e',
      frame: 0,
      durationMs: 83,
      mirrored: false,
      sheet: 'sir-knight-2-blue.png',
    });
  });

  it('AC-EXP-012.1: frame name is label_dir_000', async () => {
    const out = await run({}, [{label: 'attack-1', frames: 1}], 1);
    expect(manifestOf(out.zipFiles, 'sir-knight-2-blue').frames[0]?.name).toBe(
      'attack-1_s_000',
    );
  });

  it('AC-EXP-012.2: duplicate-clip labels give distinct tags without : / #', async () => {
    const out = await run(
      {},
      [
        {label: 'attack-1', frames: 1},
        {label: 'attack-1-2', frames: 1},
      ],
      1,
    );
    const names = manifestOf(out.zipFiles, 'sir-knight-2-blue').frames.map(
      f => f.name,
    );
    expect(names).toEqual(['attack-1_s_000', 'attack-1-2_s_000']);
    expect(names.every(n => !/[:/#]/.test(n))).toBe(true);
  });

  it('EXP_DUPLICATE_TAG: two entries with one label are refused', async () => {
    const render = renderSettings([{label: 'walk', frames: 1}], 1, 32);
    const dup = {
      ...render,
      animations: [...render.animations, ...render.animations],
    };
    const res = await exportSpriteSheet(
      [makeFrame('walk', 0, 0, 4, 4)],
      settings(),
      makeContext(dup),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('EXP_DUPLICATE_TAG');
  });

  it('metadata none writes neither manifest nor Aseprite JSON', async () => {
    const out = await run({metadata: 'none'});
    expect(Object.keys(out.zipFiles).sort()).toEqual([
      'CREDITS.txt',
      'sir-knight-2-blue.png',
    ]);
  });

  it('REQ-EXP-018: JSON is 2-space indented with LF and a trailing newline', async () => {
    const out = await run();
    const t = text(out.zipFiles['sir-knight-2-blue.manifest.json']);
    expect(t.endsWith('}\n')).toBe(true);
    expect(t).not.toContain('\r');
    expect(t.split('\n')[1]).toMatch(/^ {2}"/);
  });
});

describe('frames-zip and packaging (REQ-EXP-013, 017)', () => {
  it('AC-EXP-013.1: 2 clips x 2 directions x 4 frames give 16 frame PNGs plus metadata and credits', async () => {
    const clips = [
      {label: 'idle', frames: 4},
      {label: 'walk', frames: 4},
    ];
    const out = await run({layout: 'frames-zip', scales: [1, 2]}, clips, 2);
    const pngs = Object.keys(out.zipFiles).filter(n => n.endsWith('.png'));
    expect(pngs.filter(n => n.startsWith('sir-knight-2-blue/'))).toHaveLength(
      16,
    );
    expect(pngs).toContain('sir-knight-2-blue/idle/e/000.png');
    expect(pngs).toContain('sir-knight-2-blue@2x/walk/w/003.png');
    expect(out.zipFiles['CREDITS.txt']).toBeDefined();
    expect(out.zipFiles['sir-knight-2-blue.manifest.json']).toBeDefined();
    const m = manifestOf(out.zipFiles, 'sir-knight-2-blue');
    expect(m.frames[0]?.sheet).toBe('sir-knight-2-blue/idle/e/000.png');
  });

  it('AC-EXP-017.1: the result is one ZIP named base.zip with CREDITS.txt at its root', async () => {
    const out = await run();
    expect(out.zipName).toBe('sir-knight-2-blue.zip');
    expect(Object.keys(out.zipFiles)).toContain('CREDITS.txt');
    expect(out.files.map(f => f.name)).toEqual(
      [...out.files.map(f => f.name)].sort(),
    );
  });
});

describe('determinism (REQ-EXP-018)', () => {
  it('AC-EXP-018.1: two exports of the same input have identical ZIP and file hashes', async () => {
    const a = await run({scales: [1, 2]});
    const b = await run({scales: [1, 2]});
    expect(sha256(a.zip)).toBe(sha256(b.zip));
    expect(a.files.map(f => sha256(f.bytes))).toEqual(
      b.files.map(f => sha256(f.bytes)),
    );
  });

  it('AC-EXP-018.2: every PNG in the export has only IHDR, IDAT, IEND', async () => {
    const out = await run({scales: [1, 2]});
    for (const f of out.files.filter(f => f.name.endsWith('.png'))) {
      expect(parsePng(f.bytes).chunks).toEqual(['IHDR', 'IDAT', 'IEND']);
    }
  });

  it('AC-EXP-018.3: output hashes equal the committed golden hashes', async () => {
    const out = await run({paddingPx: 1});
    expect(
      Object.fromEntries(out.files.map(f => [f.name, sha256(f.bytes)])),
    ).toEqual(GOLDEN_FILES);
    expect(sha256(out.zip)).toBe(GOLDEN_ZIP);
  });
});

describe('credits and licences (REQ-EXP-020..022)', () => {
  const entries = [
    {
      ref: 'user:9a2e',
      kind: 'part' as const,
      license: {
        ...CC0,
        license: 'other' as const,
        commercialUse: 'unknown' as const,
        author: 'X',
      },
    },
    {ref: 'user:6f1c', kind: 'part' as const, license: CC_BY},
    {
      ref: 'builtin:quaternius-ubc/body-regular-m',
      kind: 'body' as const,
      license: CC0,
    },
    {
      ref: 'builtin:quaternius-ubc/body-regular-m',
      kind: 'body' as const,
      license: CC0,
    },
  ];

  it('AC-EXP-020.1: entries are unique and sorted by ref, with declared licence data', () => {
    const render = renderSettings([{label: 'idle', frames: 1}], 1, 32);
    const t = buildCreditsTxt(makeContext(render, entries), 'knight', '0.1.0');
    const refs = [...t.matchAll(/^(builtin:\S+|user:\S+)$/gm)].map(m => m[1]);
    expect(refs).toEqual([
      'builtin:quaternius-ubc/body-regular-m',
      'user:6f1c',
      'user:9a2e',
    ]);
    expect(t).toContain(
      'Source: https://example.org/hood | Attribution required: yes',
    );
    expect(
      t.startsWith(
        'Credits for knight (exported with Character Sprite Generator 0.1.0)\n',
      ),
    ).toBe(true);
    expect(t.endsWith('\n')).toBe(true);
  });

  it('AC-EXP-022.1: the attribution block holds exactly the CC-BY line', () => {
    const render = renderSettings([{label: 'idle', frames: 1}], 1, 32);
    const t = buildCreditsTxt(makeContext(render, entries), 'knight', '0.1.0');
    const block = t.split('== Attribution required ==\n')[1]?.split('\n\n')[0];
    expect(block).toBe(
      '"Leather Hood" by Jane Doe (CC-BY-4.0) https://example.org/hood',
    );
  });

  it('AC-EXP-022.2: with no attribution-required asset the block is exactly "(none)" and All assets still lists every asset', () => {
    const credits = [
      {ref: 'builtin:a/b', kind: 'body' as const, license: CC0},
      {ref: 'builtin:a/c', kind: 'part' as const, license: CC0},
    ];
    const render = renderSettings([{label: 'idle', frames: 1}], 1, 32);
    const t = buildCreditsTxt(makeContext(render, credits), 'k', '1');
    const block = t.split('== Attribution required ==\n')[1]?.split('\n\n')[0];
    expect(block).toBe('(none)');
    const all = t.split('== All assets ==\n')[1] ?? '';
    expect(all).toContain('builtin:a/b');
    expect(all).toContain('builtin:a/c');
  });

  it('AC-EXP-021.2: CC0-only credits give no warnings and no WARNINGS section', () => {
    const credits = [{ref: 'builtin:a/b', kind: 'body' as const, license: CC0}];
    expect(licenseWarnings(credits)).toEqual([]);
    const render = renderSettings([{label: 'idle', frames: 1}], 1, 32);
    expect(
      buildCreditsTxt(makeContext(render, credits), 'k', '1'),
    ).not.toContain('WARNINGS');
  });

  it('AC-EXP-021.1/.3: unknown, non-commercial and share-alike are grouped per code and repeated in credits and manifest', async () => {
    const credits = [
      {
        ref: 'user:a',
        kind: 'part' as const,
        license: {...CC0, license: 'other' as const},
      },
      {
        ref: 'user:b',
        kind: 'part' as const,
        license: {...CC0, commercialUse: 'no' as const},
      },
      {
        ref: 'user:c',
        kind: 'part' as const,
        license: {...CC0, license: 'CC-BY-SA-4.0' as const},
      },
      {
        ref: 'user:d',
        kind: 'part' as const,
        license: {...CC0, commercialUse: 'unknown' as const},
      },
    ];
    expect(licenseWarnings(credits)).toEqual([
      {code: 'LICENSE_UNKNOWN', assets: ['user:a', 'user:d']},
      {code: 'LICENSE_NON_COMMERCIAL', assets: ['user:b']},
      {code: 'LICENSE_SHARE_ALIKE', assets: ['user:c']},
    ]);
    const render = renderSettings([{label: 'idle', frames: 1}], 1, 32);
    const res = await exportSpriteSheet(
      [makeFrame('idle', 0, 0, 4, 4)],
      settings(),
      makeContext(render, credits),
    );
    if (!res.ok) throw new Error('failed');
    const zip = readZip(res.value.zip);
    expect(text(zip['CREDITS.txt'])).toContain(
      '== WARNINGS ==\nLICENSE_UNKNOWN: user:a, user:d\n',
    );
    expect(manifestOf(zip, 'sir-knight-2-blue').warnings).toHaveLength(3);
  });
});

describe('limits (REQ-EXP-025, 027)', () => {
  const nine = [{label: 'walk', frames: 9}];

  it('AC-EXP-025.1: 128 px cells, scale 8 and 9 columns are refused before rendering', () => {
    const render = renderSettings(nine, 1, 128);
    const plan = planExport(render, settings({scales: [8]}), 9);
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.error.code).toBe('EXP_TOO_LARGE');
      expect(plan.error.message).toContain('8192');
    }
  });

  it('AC-EXP-025.2: a 4608 px wide sheet is allowed with EXP_LARGE_TEXTURE', () => {
    const render = renderSettings(nine, 1, 128);
    const plan = planExport(render, settings({scales: [4]}), 9);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.value.scales[0]?.sheets[0]?.width).toBe(4608);
      expect(plan.value.warnings.map(w => w.code)).toEqual([
        'EXP_LARGE_TEXTURE',
      ]);
    }
  });

  it('REQ-EXP-025: more than 4096 frames and more than 512 MB are refused', () => {
    const render = renderSettings([{label: 'walk', frames: 8}], 8, 128);
    const frames = planExport(render, settings(), 4097);
    expect(frames.ok).toBe(false);
    const big = renderSettings(
      Array.from({length: 32}, (_, i) => ({label: `c-${i}`, frames: 64})),
      8,
      128,
    );
    const bytes = planExport(
      big,
      settings({layout: 'frames-zip', scales: [1, 2, 4, 8]}),
      4096,
    );
    expect(bytes.ok).toBe(false);
    if (!bytes.ok)
      expect(bytes.error.details?.limit).toBe('uncompressed RGBA bytes');
  });

  it('AC-EXP-025.2: the exporter writes EXP_LARGE_TEXTURE to the manifest', async () => {
    const clips = [{label: 'walk', frames: 9}];
    const render = renderSettings(clips, 1, 32);
    const frames = makeFrames(clips, 1, 512, 2);
    const res = await exportSpriteSheet(
      frames,
      settings(),
      makeContext(render),
    );
    if (!res.ok) throw new Error(res.error.message);
    expect(res.value.warnings.map(w => w.code)).toContain('EXP_LARGE_TEXTURE');
    expect(
      manifestOf(readZip(res.value.zip), 'sir-knight-2-blue').warnings.map(
        w => w.code,
      ),
    ).toContain('EXP_LARGE_TEXTURE');
  });

  it('AC-EXP-027.1: fully transparent frames warn EXP_EMPTY_FRAMES and still export', async () => {
    const render = renderSettings([{label: 'idle', frames: 1}], 1, 32);
    const blank = {
      ...makeFrame('idle', 0, 0, 4, 4),
      pixels: new Uint8ClampedArray(64),
    };
    const res = await exportSpriteSheet(
      [blank],
      settings(),
      makeContext(render),
    );
    expect(res.ok).toBe(true);
    if (res.ok)
      expect(res.value.warnings.map(w => w.code)).toContain('EXP_EMPTY_FRAMES');
  });
});

describe('progress and cancel (REQ-EXP-023, 024)', () => {
  it('AC-EXP-023.1: progress is non-decreasing per phase and ends at done === total', async () => {
    const render = renderSettings(CLIPS, 2, 32);
    const frames = makeFrames(CLIPS, 2, 4, 4);
    const events: Array<{phase: string; done: number; total: number}> = [];
    await exportSpriteSheet(
      frames,
      settings({scales: [1, 2]}),
      makeContext(render),
      {
        onProgress: p => events.push(p),
      },
    );
    for (const phase of ['encode', 'package']) {
      const e = events.filter(x => x.phase === phase);
      expect(e.length).toBeGreaterThan(1);
      expect(e.map(x => x.done)).toEqual(
        [...e.map(x => x.done)].sort((a, b) => a - b),
      );
      expect(e[e.length - 1]?.done).toBe(e[e.length - 1]?.total);
    }
  });

  it('AC-EXP-024.1: aborting rejects with EXP_CANCELLED and returns no files', async () => {
    const render = renderSettings(CLIPS, 2, 32);
    const frames = makeFrames(CLIPS, 2, 4, 4);
    const ctl = new AbortController();
    const p = exportSpriteSheet(
      frames,
      settings({layout: 'frames-zip'}),
      makeContext(render),
      {
        signal: ctl.signal,
        onProgress: e => {
          if (e.phase === 'encode' && e.done === 5) ctl.abort();
        },
      },
    );
    await expect(p).rejects.toMatchObject({code: 'EXP_CANCELLED'});
    await expect(p).rejects.toBeInstanceOf(ExportError);
  });
});

const GOLDEN_FILES: Record<string, string> = {
  'CREDITS.txt':
    '71a7c1e420d5755a4d2579495fb65b9b918a1a41a74dd832e2816bf513ccbd16',
  'sir-knight-2-blue.json':
    '8da43cc59786f3d11dcc80358435006368d42aedd749b6df115c18cc0d0f937e',
  'sir-knight-2-blue.manifest.json':
    'b30747a02a34cc038926112e0c1c15aa7598026f25a77eb05f0e6bace2e5ac2a',
  'sir-knight-2-blue.png':
    'fade7194fb8e245983702434e2e0c6f624c43211373516f9c211f5545e2dd3a9',
};
const GOLDEN_ZIP =
  'c4334d6667c7c434e33721d79aa9f679b8a3dadd7c5bce51acf70fe374d56bee';
