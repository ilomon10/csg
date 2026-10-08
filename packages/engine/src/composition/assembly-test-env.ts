/**
 * Test-only setup for the assembly and renderer tests: a real asset registry over the committed
 * fixture pack (packages/engine/test/fixtures/pack) with an in-memory fetch, plus a counting
 * wrapper that exposes how often parts and clips are resolved. Never imported by runtime code.
 */
import {readFileSync} from 'node:fs';
import {
  characterSpecSchema,
  clipManifestSchema,
  partManifestSchema,
} from '@csg/parts-schema';
import type {
  CharacterSpec,
  ClipManifest,
  PartEntry,
  PartManifest,
} from '@csg/parts-schema';
import {createGlbLoader} from '../loaders/glb-loader';
import {createTestFetch} from '../loaders/test-glb';
import {createAssetRegistry} from '../registry/asset-registry';
import type {EngineAssetRegistry} from '../registry/asset-registry';
import type {AssemblyRegistry} from './character-assembly';
import {readFixtureBytes} from './test-fixtures';

const FIXTURES = new URL('../../test/fixtures/', import.meta.url);

/** Pack base URL used by the tests (relative, allowed without an origin). */
export const TEST_BASE = 'packs/fixture-pack/';

/** Ref of a fixture-pack part or clip. */
export function ref(id: string): string {
  return `builtin:fixture-pack/${id}`;
}

function readJson(path: string): unknown {
  return JSON.parse(
    new TextDecoder().decode(readFileSync(new URL(path, FIXTURES))),
  );
}

/**
 * The fixture part manifest plus test-only entries that reuse committed files:
 * - `fixture-body-b`: the fixture body whose `characterSkeletonGroup` is `fixture-b`
 *   (stands in for the female/male body switch: a different character skeleton group);
 * - `fixture-body-primary`: the fixture body with its `Body` material mapped to `primary`;
 * - `fixture-missing`: a torso whose file is not served (load failure).
 */
export function testPartManifest(): PartManifest {
  const manifest = partManifestSchema.parse(readJson('pack/manifest.json'));
  const body = manifest.parts.find(p => p.id === 'fixture-body') as PartEntry;
  const shirt = manifest.parts.find(p => p.id === 'fixture-shirt') as PartEntry;
  return {
    ...manifest,
    parts: [
      ...manifest.parts,
      {...body, id: 'fixture-body-b', characterSkeletonGroup: 'fixture-b'},
      {
        ...body,
        id: 'fixture-body-primary',
        tintSlots: [{material: 'Body', slot: 'primary', mode: 'multiply'}],
      },
      {...shirt, id: 'fixture-missing', file: 'parts/not-served.glb'},
    ],
  };
}

/**
 * The fixture clip manifest plus `fixture-clip-ip`, the in-place variant of `fixture-clip`
 * (same file, `hasRootMotion: false`; REQ-ANM-014).
 */
export function testClipManifest(): ClipManifest {
  const manifest = clipManifestSchema.parse(readJson('pack/clips.json'));
  const [clip] = manifest.clips;
  if (clip === undefined) throw new Error('fixture clip manifest is empty');
  return {
    ...manifest,
    clips: [
      {...clip, inPlaceVariant: 'fixture-clip-ip'},
      {...clip, id: 'fixture-clip-ip', hasRootMotion: false},
    ],
  };
}

/** The fixture `CharacterSpec` (body, shirt, sword). */
export function fixtureSpec(): CharacterSpec {
  return characterSpecSchema.parse(readJson('character.valid.json'));
}

/** A registry over the fixture pack and counters of its resolve calls. */
export interface TestRegistry extends AssemblyRegistry {
  readonly inner: EngineAssetRegistry;
  readonly resolveCalls: string[];
  readonly resolveClipCalls: string[];
}

/** Creates a registry over the fixture pack (served from memory) that counts resolve calls. */
export function createTestRegistry(): TestRegistry {
  const parts = testPartManifest();
  const clips = testClipManifest();
  const files = new Map<string, ArrayBuffer>();
  for (const entry of [...parts.parts, ...clips.clips]) {
    if (entry.file.includes('not-served')) continue;
    files.set(
      `${TEST_BASE}${entry.file}`,
      readFixtureBytes(`pack/${entry.file}`),
    );
  }
  const inner = createAssetRegistry({
    loader: createGlbLoader({fetch: createTestFetch(files).fetch}),
  });
  inner.registerPack(parts, TEST_BASE);
  inner.registerClips(clips, TEST_BASE);
  const resolveCalls: string[] = [];
  const resolveClipCalls: string[] = [];
  return {
    inner,
    resolveCalls,
    resolveClipCalls,
    resolve(r) {
      resolveCalls.push(r);
      return inner.resolve(r);
    },
    resolveClip(r) {
      resolveClipCalls.push(r);
      return inner.resolveClip(r);
    },
    clipEntry: r => inner.clipEntry(r),
  };
}
