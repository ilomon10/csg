import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {parsePackConfig} from '@csg/parts-schema';
import type {PackConfig} from '@csg/parts-schema';

const here = import.meta.dirname;
const repoRoot = resolve(here, '..');
const sources = JSON.parse(
  readFileSync(join(repoRoot, 'tools/asset-sources.json'), 'utf8'),
) as {packs: Array<{packId: string; dir: string}>};

const PACKS = ['quaternius-ubc', 'quaternius-outfits', 'quaternius-ual'];

function load(packId: string): PackConfig {
  const json: unknown = JSON.parse(
    readFileSync(join(here, 'packs', packId, 'pack.config.json'), 'utf8'),
  );
  const result = parsePackConfig(json);
  if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
  return result.value;
}

/** Free glTF/GLB source files that are intentionally not mapped (reasons: tools/packs/<id>/README.md). */
const SKIPPED: Array<{packId: string; pattern: RegExp}> = [
  {packId: 'quaternius-ubc', pattern: /^Hairstyles\/Origin at 0\//},
  {packId: 'quaternius-outfits', pattern: /\/Outfits\/[^/]+\.gltf$/},
  {packId: 'quaternius-ual', pattern: /_RM\.glb$/},
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('pack configs (REQ-AST-009, REQ-CMP-036)', () => {
  for (const packId of PACKS) {
    it(`AC-AST-009.1: ${packId} config validates with parsePackConfig`, () => {
      expect(load(packId).packId).toBe(packId);
    });
  }

  it('REQ-CMP-036: bodies, characterSkeletonGroup and body fit lists', () => {
    const ubc = load('quaternius-ubc');
    const m = ubc.parts.find(p => p.id === 'superhero-m');
    const f = ubc.parts.find(p => p.id === 'superhero-f');
    expect(m?.characterSkeletonGroup).toBe('male');
    expect(f?.characterSkeletonGroup).toBe('female');
    const bodyIds = new Set(
      ubc.parts.filter(p => p.slot === 'body').map(p => p.id),
    );
    const outfits = load('quaternius-outfits');
    for (const part of [...ubc.parts, ...outfits.parts]) {
      if (part.slot === 'body') continue;
      expect(part.bodies, part.id).toHaveLength(1);
      const body = part.bodies?.[0] ?? '';
      expect(bodyIds.has(body), part.id).toBe(true);
      const male = part.tags.includes('male');
      expect(male || part.tags.includes('female'), part.id).toBe(true);
      expect(body, part.id).toBe(male ? 'superhero-m' : 'superhero-f');
    }
  });

  it('REQ-CMP-036: default spec parts exist in the configs', () => {
    const ubc = load('quaternius-ubc');
    const outfits = load('quaternius-outfits');
    for (const id of [
      'superhero-m',
      'hair-simple-parted',
      'eyebrows-regular',
    ]) {
      expect(
        ubc.parts.some(p => p.id === id),
        id,
      ).toBe(true);
    }
    for (const id of [
      'male-ranger-torso',
      'male-ranger-arms',
      'male-ranger-legs',
      'male-ranger-boots',
    ]) {
      expect(
        outfits.parts.some(p => p.id === id),
        id,
      ).toBe(true);
    }
    const ual = load('quaternius-ual');
    for (const id of ['idle', 'walk']) {
      expect(
        ual.clips.some(c => c.id === id),
        id,
      ).toBe(true);
    }
  });

  const srcRoot = join(repoRoot, 'assets-src');
  for (const packId of PACKS) {
    const entry = sources.packs.find(p => p.packId === packId);
    const dir = entry === undefined ? undefined : join(srcRoot, entry.dir);
    it.skipIf(dir === undefined || !existsSync(dir))(
      `REQ-AST-002: ${packId} maps or skips every glTF source file`,
      () => {
        if (dir === undefined) return;
        const config = load(packId);
        const mapped = new Set([
          ...config.parts.map(p => p.match.file),
          ...config.clips.map(c => c.match.file),
        ]);
        const files = walk(dir)
          .map(f => relative(dir, f).split('\\').join('/'))
          .filter(f => /\.(gltf|glb)$/.test(f));
        const skips = SKIPPED.filter(s => s.packId === packId);
        for (const file of files) {
          const skipped = skips.some(s => s.pattern.test(file));
          expect(mapped.has(file) || skipped, file).toBe(true);
        }
        for (const file of mapped) expect(files, file).toContain(file);
      },
    );
  }
});
