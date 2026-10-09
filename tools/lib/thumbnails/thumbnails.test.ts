import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import type {PartEntry} from '@csg/parts-schema';
import {checkPackPresets} from '../check/presets.js';
import {findOrphans} from '../check/orphans.js';
import type {CheckIssue} from '../check/types.js';
import {
  checkPackThumbnails,
  parseThumbnailIndex,
  serializeThumbnailIndex,
  sha256Hex,
} from './index-file.js';
import {
  DEFAULT_LOOK_ID,
  SLOT_FRAMING_REGIONS,
  THUMBNAIL_SHAPE_STYLES,
  planThumbnails,
} from './jobs.js';
import type {PlanPack, ThumbnailJob} from './jobs.js';
import {registerPartThumbnails} from './register.js';
import {readWebpInfo} from './webp.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** A minimal simple-lossless WebP header (VP8L) of `w` x `h`, padded to `size` bytes. */
function vp8l(w: number, h: number, size = 64): Uint8Array {
  const b = new Uint8Array(size);
  b.set([0x52, 0x49, 0x46, 0x46], 0);
  const riff = size - 8;
  b.set([riff & 255, (riff >> 8) & 255, (riff >> 16) & 255, riff >>> 24], 4);
  b.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c], 8);
  const chunk = size - 20;
  b.set([chunk & 255, (chunk >> 8) & 255, 0, 0], 16);
  const bits = (w - 1) | ((h - 1) << 14);
  b.set(
    [0x2f, bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, bits >>> 24],
    20,
  );
  return b;
}

function part(
  id: string,
  slot: PartEntry['slot'],
  extra: Partial<PartEntry> = {},
): PartEntry {
  return {
    id,
    name: id,
    slot,
    kind: 'skinned',
    file: `parts/${id}.glb`,
    rig: 'r',
    hides: [],
    tintSlots: [],
    sha256: 'a'.repeat(64),
    stats: {triangles: 1, textures: 0},
    tags: [],
    ...extra,
  } as PartEntry;
}

const LOOK = {
  format: 'sprite-look-preset',
  version: 1,
  id: DEFAULT_LOOK_ID,
  name: 'Classic',
  description: '',
  thumbnail: `thumbnails/looks/${DEFAULT_LOOK_ID}.webp`,
  materialGraph: 'builtin:material-toon',
  postGraph: 'builtin:post-default',
  params: {},
  render: {toon: {bands: 3}},
};

function fixturePacks(hairSha = 'b'.repeat(64)): PlanPack[] {
  return [
    {
      packId: 'quaternius-ubc',
      rigs: [{id: 'r'}],
      parts: [
        part('superhero-m', 'body', {bodyType: 'male'} as Partial<PartEntry>),
        part('superhero-f', 'body', {bodyType: 'female'} as Partial<PartEntry>),
        part('hair-long', 'hair', {bodies: ['superhero-f'], sha256: hairSha}),
        part('hair-simple-parted', 'hair'),
        part('eyebrows-regular', 'eyebrows'),
      ],
      presets: [
        {kind: 'look', json: LOOK},
        {kind: 'style', json: {style: 'realistic', anatomyPreset: 'realistic'}},
        {kind: 'style', json: {style: 'chibi', anatomyPreset: 'chibi'}},
        {
          kind: 'anatomy-preset',
          json: {id: 'realistic', values: {height: 1, head: 1}},
        },
        {
          kind: 'anatomy-preset',
          json: {id: 'chibi', values: {height: 0.85, head: 1.8}},
        },
        {kind: 'body-shape', json: {id: 'slim', factors: {torsoWidth: 0.85}}},
        {kind: 'body-shape', json: {id: 'tall', factors: {height: 1.1}}},
      ],
    },
    {
      packId: 'quaternius-outfits',
      rigs: [{id: 'r'}],
      parts: [
        part('male-ranger-torso', 'torso'),
        part('male-ranger-arms', 'arms'),
        part('male-ranger-legs', 'legs'),
        part('male-ranger-boots', 'feet'),
      ],
      presets: [],
    },
  ];
}

describe('thumbnail plan (REQ-AST-015, REQ-AST-039)', () => {
  it('AC-AST-015.1: one 128 px part thumbnail per part, on a body it fits, framed on its slot region', () => {
    const {jobs, problems} = planThumbnails(fixturePacks());
    expect(problems).toEqual([]);
    const hair = jobs.find(j => j.path === 'thumbnails/hair-long.webp')!;
    expect(hair.character.body.ref).toBe('builtin:quaternius-ubc/superhero-f');
    expect(hair.character.parts).toEqual({
      hair: {ref: 'builtin:quaternius-ubc/hair-long'},
    });
    expect(hair.framing).toMatchObject({
      mode: 'region',
      regions: SLOT_FRAMING_REGIONS.hair,
    });
    expect(hair.cellPx * hair.scale).toBe(128);
    expect(hair.settings.camera.preset).toBe('three-quarter');
    expect(hair.settings.singleFacing).toBe('se');
    const body = jobs.find(j => j.path === 'thumbnails/superhero-f.webp')!;
    expect(body.framing).toEqual({mode: 'auto'});
    expect(body.character.parts).toEqual({});
  });

  it('AC-AST-039.3: body-shape thumbnails per supported style and shape at 64 px with one scale per style', () => {
    const {jobs} = planThumbnails(fixturePacks());
    const shapes = jobs.filter(j => j.kind === 'shape');
    expect(shapes.map(j => j.path).sort()).toEqual([
      'thumbnails/shapes/chibi/slim.webp',
      'thumbnails/shapes/chibi/tall.webp',
      'thumbnails/shapes/realistic/slim.webp',
      'thumbnails/shapes/realistic/tall.webp',
    ]);
    for (const j of shapes) expect(j.cellPx * j.scale).toBe(64);
    const chibiTall = shapes.find(j => j.path.endsWith('chibi/tall.webp'))!;
    expect(chibiTall.character.style).toBe('chibi');
    expect(chibiTall.character.anatomy.head).toBe(1.8);
    expect(chibiTall.character.anatomy.height).toBe(0.94);
    expect(chibiTall.framing).toEqual({
      mode: 'shared',
      group: 'shapes/quaternius-ubc/chibi',
    });
    expect(THUMBNAIL_SHAPE_STYLES).toEqual(['realistic', 'chibi']);
  });

  it('AC-AST-039.1: looks render 64 px under their own settings at their thumbnail path', () => {
    const {jobs} = planThumbnails(fixturePacks());
    const look = jobs.find(j => j.kind === 'look')!;
    expect(look.path).toBe(`thumbnails/looks/${DEFAULT_LOOK_ID}.webp`);
    expect(look.cellPx * look.scale).toBe(64);
    expect(look.settings.toon.bands).toBe(3);
  });

  it('AC-AST-015.1: the plan is deterministic and a changed part changes only its own inputs', () => {
    const a = planThumbnails(fixturePacks()).jobs;
    const b = planThumbnails(fixturePacks()).jobs;
    expect(b).toEqual(a);
    const c = planThumbnails(fixturePacks('c'.repeat(64))).jobs;
    const changed = a
      .filter((j, i) => j.inputs !== c[i]!.inputs)
      .map(j => j.path);
    expect(changed).toEqual(['thumbnails/hair-long.webp']);
    // A part of the default character changes every look and shape thumbnail too.
    const packs = fixturePacks();
    (packs[1]!.parts as PartEntry[])[0] = part('male-ranger-torso', 'torso', {
      sha256: 'd'.repeat(64),
    });
    const d = planThumbnails(packs).jobs;
    const kinds = new Set(
      a.filter((j, i) => j.inputs !== d[i]!.inputs).map(j => j.kind),
    );
    expect([...kinds].sort()).toEqual(['look', 'part', 'shape']);
  });

  it('AC-AST-015.1: a part no body fits is a planning problem, not a job', () => {
    const packs = fixturePacks();
    (packs[0]!.parts as PartEntry[]).push(
      part('odd', 'hair', {bodies: ['nobody']}),
    );
    const {jobs, problems} = planThumbnails(packs);
    expect(jobs.some(j => j.id === 'odd')).toBe(false);
    expect(problems.join()).toContain('no built body fits');
  });
});

describe('thumbnail files and index', () => {
  const job = (inputs: string): ThumbnailJob =>
    ({
      packId: 'p',
      path: 'thumbnails/x.webp',
      kind: 'part',
      id: 'x',
      cellPx: 64,
      scale: 2,
      inputs,
    }) as ThumbnailJob;

  it('AC-AST-015.1: reads VP8L sizes and rejects non-WebP bytes', () => {
    expect(readWebpInfo(vp8l(128, 128))).toEqual({
      chunk: 'VP8L',
      width: 128,
      height: 128,
    });
    expect(readWebpInfo(vp8l(64, 33))?.height).toBe(33);
    expect(readWebpInfo(new Uint8Array(40))).toBeNull();
  });

  it('AC-AST-015.1: a current thumbnail is silent; stale, edited and wrong-size ones warn', () => {
    const bytes = vp8l(128, 128);
    const entry = {
      path: 'thumbnails/x.webp',
      kind: 'part' as const,
      id: 'x',
      inputs: 'i1',
      sha256: sha256Hex(bytes),
      width: 128,
      height: 128,
    };
    const index = parseThumbnailIndex(
      JSON.parse(serializeThumbnailIndex([entry])),
    );
    const files = new Map([['thumbnails/x.webp', bytes]]);
    const run = (
      j: ThumbnailJob,
      f: ReadonlyMap<string, Uint8Array | undefined> = files,
      i = index,
    ) =>
      checkPackThumbnails({packId: 'p', jobs: [j], files: f, index: i}).map(
        x => `${x.severity} ${x.code}`,
      );
    expect(run(job('i1'))).toEqual([]);
    expect(run(job('i2'))).toEqual(['warn AST_THUMBNAIL_STALE']);
    expect(run(job('i1'), files, null)).toEqual(['warn AST_THUMBNAIL_STALE']);
    const edited = vp8l(128, 128, 66);
    expect(run(job('i1'), new Map([['thumbnails/x.webp', edited]]))).toEqual([
      'warn AST_THUMBNAIL_STALE',
    ]);
    const small = vp8l(64, 64);
    expect(run(job('i1'), new Map([['thumbnails/x.webp', small]]))[0]).toBe(
      'warn AST_THUMBNAIL_INVALID',
    );
    expect(run(job('i1'), new Map([['thumbnails/x.webp', undefined]]))).toEqual(
      [],
    );
  });

  it('AC-AST-015.1: the manifest thumbnail field follows the files', () => {
    const manifest = {
      packId: 'p',
      parts: [{id: 'a'}, {id: 'b', thumbnail: 'thumbnails/b.webp'}],
    };
    const out = registerPartThumbnails(
      manifest,
      p => p === 'thumbnails/a.webp',
    );
    expect(out.changed).toBe(true);
    expect(out.manifest['parts']).toEqual([
      {id: 'a', thumbnail: 'thumbnails/a.webp'},
      {id: 'b'},
    ]);
    expect(
      registerPartThumbnails(out.manifest, p => p === 'thumbnails/a.webp')
        .changed,
    ).toBe(false);
  });
});

/** A built pack folder with one character preset, the chibi style and the slim shape. */
function presetPack(): string {
  const dir = mkdtempSync(join(tmpdir(), 'csg-thumbs-'));
  const files: Array<[string, string, unknown]> = [
    [
      'character',
      'presets/characters/knight.json',
      JSON.parse(
        readFileSync(
          join(
            REPO,
            'tools/packs/quaternius-ubc/presets/characters/ranger.json',
          ),
          'utf8',
        ),
      ),
    ],
    [
      'style',
      'presets/styles/chibi.json',
      {
        format: 'sprite-style',
        version: 1,
        style: 'chibi',
        anatomyPreset: 'chibi',
        excludedClips: [],
      },
    ],
    [
      'anatomy-preset',
      'presets/anatomy/chibi.json',
      JSON.parse(
        readFileSync(
          join(REPO, 'tools/packs/quaternius-ubc/presets/anatomy/chibi.json'),
          'utf8',
        ),
      ),
    ],
    [
      'body-shape',
      'presets/body-shapes/slim.json',
      JSON.parse(
        readFileSync(
          join(
            REPO,
            'tools/packs/quaternius-ubc/presets/body-shapes/slim.json',
          ),
          'utf8',
        ),
      ),
    ],
  ];
  (files[0]![2] as Record<string, unknown>)['id'] = 'knight';
  for (const [, path, json] of files) {
    mkdirSync(dirname(join(dir, path)), {recursive: true});
    writeFileSync(join(dir, path), JSON.stringify(json));
  }
  writeFileSync(
    join(dir, 'presets/index.json'),
    JSON.stringify({
      format: 'sprite-preset-index',
      version: 1,
      files: files.map(([kind, path]) => ({kind, path})),
    }),
  );
  return dir;
}

async function checkPreset(dir: string) {
  const issues: CheckIssue[] = [];
  const referenced = new Set<string>();
  await checkPackPresets({
    packId: 'fx',
    packDir: dir,
    configsDir: join(dir, 'no-configs'),
    referenced,
    add: i => issues.push(i),
  });
  return {issues, referenced};
}

describe('preset thumbnails in assets:check (REQ-AST-039)', () => {
  it('AC-AST-039.1: a missing character thumbnail warns naming the preset and path; once added it is referenced', async () => {
    const dir = presetPack();
    const before = await checkPreset(dir);
    const warn = before.issues.find(
      i => i.code === 'AST_THUMBNAIL_MISSING' && i.id === 'knight',
    );
    expect(warn?.severity).toBe('warn');
    expect(warn?.message).toContain('thumbnails/characters/knight.webp');
    expect(before.issues.filter(i => i.severity === 'error')).toEqual([]);

    mkdirSync(join(dir, 'thumbnails/characters'), {recursive: true});
    writeFileSync(
      join(dir, 'thumbnails/characters/knight.webp'),
      vp8l(128, 128),
    );
    const after = await checkPreset(dir);
    expect(
      after.issues.some(
        i => i.code === 'AST_THUMBNAIL_MISSING' && i.id === 'knight',
      ),
    ).toBe(false);
    expect(
      findOrphans(
        'fx',
        ['thumbnails/characters/knight.webp'],
        after.referenced,
      ),
    ).toEqual([]);
  });

  it('AC-AST-039.3: a chibi slim shape thumbnail is expected, and referenced once present', async () => {
    const dir = presetPack();
    const before = await checkPreset(dir);
    expect(before.issues.find(i => i.id === 'slim')?.message).toContain(
      'thumbnails/shapes/chibi/slim.webp',
    );
    mkdirSync(join(dir, 'thumbnails/shapes/chibi'), {recursive: true});
    writeFileSync(join(dir, 'thumbnails/shapes/chibi/slim.webp'), vp8l(64, 64));
    const after = await checkPreset(dir);
    expect(after.issues.some(i => i.id === 'slim')).toBe(false);
    expect(
      findOrphans(
        'fx',
        ['thumbnails/shapes/chibi/slim.webp'],
        after.referenced,
      ),
    ).toEqual([]);
  });

  it('AC-AST-039.2: every bundled look thumbnail is thumbnails/looks/<id>.webp', () => {
    const index = JSON.parse(
      readFileSync(
        join(REPO, 'assets/packs/quaternius-ubc/presets/index.json'),
        'utf8',
      ),
    ) as {files: Array<{kind: string; path: string}>};
    const looks = index.files.filter(f => f.kind === 'look');
    expect(looks.length).toBeGreaterThanOrEqual(4);
    for (const f of looks) {
      const look = JSON.parse(
        readFileSync(join(REPO, 'assets/packs/quaternius-ubc', f.path), 'utf8'),
      ) as {id: string; thumbnail: string};
      expect(look.thumbnail).toBe(`thumbnails/looks/${look.id}.webp`);
    }
  });
});
