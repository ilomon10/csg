import {mkdtemp, readdir, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  clipManifestSchema,
  packConfigSchema,
  partManifestSchema,
  rigDefinitionSchema,
  validatePartsAgainstRig,
} from '@csg/parts-schema';
import type {PackConfig} from '@csg/parts-schema';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {canonicalJson} from './canonical-json.js';
import {buildClipManifest} from './clips-manifest.js';
import {emitPack} from './emit.js';
import type {EmitPart} from './emit.js';
import {buildPartManifest, ManifestBuildError, sha256Hex} from './manifest.js';

const rig = rigDefinitionSchema.parse(
  JSON.parse(
    await readFile(
      new URL(
        '../../../packages/parts-schema/rigs/quaternius-ue5-65.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ),
);

const license = {
  license: 'CC0-1.0' as const,
  author: 'Test Author',
  sourceUrl: 'https://example.com/pack',
  commercialUse: 'yes' as const,
  attributionRequired: false,
};

function makeConfig(): PackConfig {
  return packConfigSchema.parse({
    format: 'sprite-pack-config',
    version: 1,
    packId: 'fixture-pack',
    name: 'Fixture Pack',
    license,
    rig: rig.id,
    parts: [
      {
        id: 'torso-b',
        match: {file: 'b.gltf', node: 'Torso'},
        name: 'Torso B',
        slot: 'torso',
        hides: ['torso'],
        tintSlots: [],
        tags: ['z'],
      },
      {
        id: 'body-a',
        match: {file: 'a.gltf'},
        name: 'Body A',
        slot: 'body',
        hides: [],
        tintSlots: [],
        bodyType: 'male',
        characterSkeletonGroup: 'male',
        tags: [],
      },
    ],
    clips: [
      {
        id: 'walk',
        match: {file: 'c.gltf', animation: 'Walk'},
        name: 'Walk',
        category: 'locomotion',
        loop: true,
        defaultFrameCount: 8,
        tags: [],
      },
    ],
  });
}

const bytes = (n: number) => new Uint8Array([n, n + 1, n + 2, 7]);
const parts = (): EmitPart[] => [
  {
    id: 'torso-b',
    kind: 'skinned' as const,
    bytes: bytes(2),
    triangles: 100,
    textures: 1,
    skeletonGroup: 'male',
  },
  {
    id: 'body-a',
    kind: 'skinned' as const,
    bytes: bytes(1),
    triangles: 200,
    textures: 0,
    skeletonGroup: 'male',
  },
];
const clips = () => [
  {
    id: 'walk',
    bytes: bytes(9),
    durationSec: 1.2,
    hasRootMotion: true,
    skeletonGroup: 'ual',
  },
];

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'emit-'));
});
afterEach(async () => {
  await rm(dir, {recursive: true, force: true});
});

async function snapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (rel: string) => {
    for (const entry of await readdir(join(root, rel), {withFileTypes: true})) {
      const p = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) await walk(p);
      else out[p] = sha256Hex(await readFile(join(root, p)));
    }
  };
  await walk('');
  return out;
}

describe('AC-AST-013.1 manifest', () => {
  it('validates, sorts, embeds the rig and records file sha256', async () => {
    const result = await emitPack({
      outRoot: dir,
      config: makeConfig(),
      rig,
      parts: parts(),
      clips: clips(),
    });
    const manifest = partManifestSchema.parse(
      JSON.parse(await readFile(join(result.packDir, 'manifest.json'), 'utf8')),
    );
    expect(validatePartsAgainstRig(manifest).ok).toBe(true);
    expect(manifest.parts.map(p => p.id)).toEqual(['body-a', 'torso-b']);
    expect(manifest.rigs[0]).toEqual(rig);
    for (const part of manifest.parts) {
      const file = await readFile(join(result.packDir, part.file));
      expect(part.sha256).toBe(sha256Hex(file));
    }
    expect(manifest.parts[1]).toMatchObject({
      file: 'parts/torso-b.glb',
      node: 'Torso',
      rig: rig.id,
      skeletonGroup: 'male',
      stats: {triangles: 100, textures: 1},
    });
    expect(manifest.parts[0]?.characterSkeletonGroup).toBe('male');
  });

  it('AC-AST-013.1 clips.json validates with sha256 and skeletonGroup', async () => {
    const result = await emitPack({
      outRoot: dir,
      config: makeConfig(),
      rig,
      parts: parts(),
      clips: clips(),
    });
    const cm = clipManifestSchema.parse(
      JSON.parse(await readFile(join(result.packDir, 'clips.json'), 'utf8')),
    );
    expect(cm.clips[0]).toMatchObject({
      file: 'clips/walk.glb',
      sourceName: 'Walk',
      sha256: sha256Hex(bytes(9)),
      skeletonGroup: 'ual',
      hasRootMotion: true,
      durationSec: 1.2,
    });
  });

  it('part without a matched skeletonGroup is built without the field (AC-AST-026.4)', () => {
    const p = parts();
    delete p[0]!.skeletonGroup;
    const m = buildPartManifest({config: makeConfig(), rig, parts: p});
    expect(
      m.parts.find(x => x.id === 'torso-b')?.skeletonGroup,
    ).toBeUndefined();
  });

  it('rejects an unknown skeleton group and missing outputs', () => {
    const p = parts();
    p[0]!.skeletonGroup = 'nope';
    expect(() =>
      buildPartManifest({config: makeConfig(), rig, parts: p}),
    ).toThrow(ManifestBuildError);
    expect(() =>
      buildPartManifest({config: makeConfig(), rig, parts: parts().slice(1)}),
    ).toThrow(/AST_MANIFEST_MISSING/);
    expect(() => buildClipManifest({config: makeConfig(), clips: []})).toThrow(
      /AST_MANIFEST_MISSING/,
    );
  });
});

describe('AC-AST-014.1 determinism', () => {
  it('two emits into clean folders are byte-identical, with no timestamps', async () => {
    const other = await mkdtemp(join(tmpdir(), 'emit2-'));
    try {
      const args = {config: makeConfig(), rig, parts: parts(), clips: clips()};
      await emitPack({outRoot: dir, ...args});
      await emitPack({outRoot: other, ...args, parts: [...parts()].reverse()});
      const a = await snapshot(dir);
      expect(a).toEqual(await snapshot(other));
      expect(Object.keys(a)).toEqual([
        'fixture-pack/clips/walk.glb',
        'fixture-pack/clips.json',
        'fixture-pack/manifest.json',
        'fixture-pack/parts/body-a.glb',
        'fixture-pack/parts/torso-b.glb',
        'fixture-pack/retired-ids.json',
      ]);
    } finally {
      await rm(other, {recursive: true, force: true});
    }
  });

  it('re-emit removes stale GLBs and keeps retired-ids.json', async () => {
    await emitPack({
      outRoot: dir,
      config: makeConfig(),
      rig,
      parts: parts(),
      clips: clips(),
      retiredIds: ['old-b', 'old-a'],
    });
    const config = makeConfig();
    config.parts = config.parts.filter(p => p.id !== 'torso-b');
    const result = await emitPack({
      outRoot: dir,
      config,
      rig,
      parts: parts().slice(1),
      clips: clips(),
    });
    expect(result.files.map(f => f.path)).not.toContain('parts/torso-b.glb');
    expect(await readdir(join(result.packDir, 'parts'))).toEqual([
      'body-a.glb',
    ]);
    const retired = JSON.parse(
      await readFile(join(result.packDir, 'retired-ids.json'), 'utf8'),
    );
    expect(retired.ids).toEqual(['old-a', 'old-b']);
  });

  it('canonicalJson sorts keys and ends with a newline', () => {
    expect(canonicalJson({b: 1, a: {d: undefined, c: [{z: 1, y: 2}]}})).toBe(
      '{\n  "a": {\n    "c": [\n      {\n        "y": 2,\n        "z": 1\n      }\n    ]\n  },\n  "b": 1\n}\n',
    );
  });
});
