/**
 * Assembles every fixture file in memory (spec 011 REQ-AST-021). Deterministic: no timestamps,
 * sorted output, fixed formatting. `make-fixtures.ts` writes the result to disk.
 */
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import type {Document} from '@gltf-transform/core';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {format, resolveConfig} from 'prettier';
import {defaultAnatomy, TINT_SLOTS} from '@csg/parts-schema';
import type {PartEntry} from '@csg/parts-schema';
import {
  FIXTURE_RIG_ID,
  GROUP_A,
  GROUP_B,
  buildRigDefinition,
} from './fixture-rig.js';
import {
  buildBody,
  buildClip,
  buildFiveInfluence,
  buildShirt,
  buildSword,
} from './fixture-models.js';

/** Fixture directory inside `@csg/engine`. */
export const ENGINE_DIR = 'packages/engine/test/fixtures';
/** Fixture directory inside `@csg/parts-schema`. */
export const SCHEMA_DIR = 'packages/parts-schema/test/fixtures';
/** Maximum size of one fixture file (AC-AST-021.1 budget, task M1-10). */
export const MAX_FILE_BYTES = 200 * 1024;
/** Maximum total size of all fixture files (REQ-AST-021). */
export const MAX_TOTAL_BYTES = 300 * 1024;

/** Relative path (from the repo root) to file contents. */
export type FixtureFiles = Map<string, Uint8Array | string>;

const PACK_ID = 'fixture-pack';
const LICENSE = {
  license: 'CC0-1.0',
  author: 'character-sprite-generator contributors',
  sourceUrl: 'https://example.com/character-sprite-generator/fixtures',
  commercialUse: 'yes',
  attributionRequired: false,
} as const;

const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

function triangles(doc: Document): number {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      n += (prim.getIndices()?.getCount() ?? 0) / 3;
    }
  }
  return n;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function json(value: unknown): Promise<string> {
  const config = await resolveConfig(resolve(repoRoot, 'fixture.json'));
  return format(JSON.stringify(value), {...config, parser: 'json'});
}

/** Builds every fixture file; keys are repo-relative paths. */
export async function buildFixtures(): Promise<FixtureFiles> {
  const io = new NodeIO();
  const out: FixtureFiles = new Map();
  const glb = async (doc: Document): Promise<Uint8Array> => io.writeBinary(doc);

  const rig = buildRigDefinition('y');
  const rigX = buildRigDefinition('x');
  const rigJson = await json(rig);
  const rigXJson = await json(rigX);

  const docs = {
    body: buildBody(),
    shirt: buildShirt(GROUP_A, 'fixture-shirt'),
    shirtB: buildShirt(GROUP_B, 'fixture-shirt-b'),
    sword: buildSword(),
  };
  const bytes = {
    body: await glb(docs.body),
    shirt: await glb(docs.shirt),
    shirtB: await glb(docs.shirtB),
    sword: await glb(docs.sword),
    clip: await glb(buildClip()),
    mismatch: await glb(
      buildShirt(GROUP_A, 'fixture-shirt-mismatch', {hand_r: 'Hand_R'}),
    ),
    five: await glb(buildFiveInfluence()),
  };

  const stats = (d: Document, textures = 0) => ({
    triangles: triangles(d),
    textures,
  });
  const skinned = (
    id: string,
    name: string,
    slot: string,
    group: string,
    material: string,
    tint: 'skin' | 'primary',
    hides: PartEntry['hides'],
    file: Uint8Array,
    doc: Document,
    extra: Partial<PartEntry> = {},
  ): PartEntry => ({
    id,
    name,
    slot,
    kind: 'skinned',
    file: `parts/${id}.glb`,
    rig: FIXTURE_RIG_ID,
    skeletonGroup: group,
    hides,
    tintSlots: [{material, slot: tint, mode: 'multiply'}],
    sha256: sha256(file),
    stats: stats(doc),
    tags: ['fixture'],
    ...extra,
  });
  const parts: PartEntry[] = [
    skinned(
      'fixture-body',
      'Fixture body',
      'body',
      GROUP_A,
      'Body',
      'skin',
      [],
      bytes.body,
      docs.body,
      {
        bodyType: 'fixture',
        characterSkeletonGroup: GROUP_A,
      },
    ),
    skinned(
      'fixture-shirt',
      'Fixture shirt',
      'torso',
      GROUP_A,
      'Shirt',
      'primary',
      ['torso'],
      bytes.shirt,
      docs.shirt,
    ),
    skinned(
      'fixture-shirt-b',
      'Fixture shirt (made on fixture-b)',
      'torso',
      GROUP_B,
      'Shirt',
      'primary',
      ['torso'],
      bytes.shirtB,
      docs.shirtB,
    ),
    {
      id: 'fixture-sword',
      name: 'Fixture sword',
      slot: 'prop-main-hand',
      kind: 'static',
      file: 'parts/fixture-sword.glb',
      socket: {
        bone: 'hand_r',
        offset: {position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1]},
      },
      hides: [],
      tintSlots: [{material: 'Metal', slot: 'metal', mode: 'replace'}],
      sha256: sha256(bytes.sword),
      stats: stats(docs.sword),
      tags: ['fixture'],
    },
  ];
  const manifest = {
    format: 'sprite-parts-manifest',
    version: 1,
    packId: PACK_ID,
    name: 'Fixture pack',
    license: LICENSE,
    rigs: [rig],
    parts,
  };
  const clips = {
    format: 'sprite-clips-manifest',
    version: 1,
    packId: PACK_ID,
    name: 'Fixture pack',
    license: LICENSE,
    clips: [
      {
        id: 'fixture-clip',
        name: 'Fixture clip',
        category: 'locomotion',
        file: 'clips/fixture-clip.glb',
        sourceName: 'fixture-clip',
        rig: FIXTURE_RIG_ID,
        durationSec: 1,
        loop: true,
        defaultFrameCount: 8,
        hasRootMotion: true,
        tags: ['fixture'],
        sha256: sha256(bytes.clip),
        skeletonGroup: GROUP_B,
      },
    ],
  };
  const tints = Object.fromEntries(
    TINT_SLOTS.map((slot, i) => [
      slot,
      `#${(0x204060 + i * 0x101010).toString(16)}`,
    ]),
  );
  const character = {
    format: 'sprite-character',
    version: 1,
    name: 'Fixture character',
    seed: 1,
    body: {ref: `builtin:${PACK_ID}/fixture-body`},
    parts: {
      torso: {ref: `builtin:${PACK_ID}/fixture-shirt`},
      'prop-main-hand': {ref: `builtin:${PACK_ID}/fixture-sword`},
    },
    anatomy: defaultAnatomy(),
    morphs: {},
    tints,
  };
  const manifestJson = await json(manifest);
  const clipsJson = await json(clips);
  const characterJson = await json(character);

  // Engine fixtures: the fixture pack layout plus variants.
  const e = (p: string) => `${ENGINE_DIR}/${p}`;
  out.set(e('rigs/fixture-ue5-22.json'), rigJson);
  out.set(e('rigs/fixture-ue5-22-x.json'), rigXJson);
  out.set(e('pack/manifest.json'), manifestJson);
  out.set(e('pack/clips.json'), clipsJson);
  out.set(e('pack/parts/fixture-body.glb'), bytes.body);
  out.set(e('pack/parts/fixture-shirt.glb'), bytes.shirt);
  out.set(e('pack/parts/fixture-shirt-b.glb'), bytes.shirtB);
  out.set(e('pack/parts/fixture-sword.glb'), bytes.sword);
  out.set(e('pack/clips/fixture-clip.glb'), bytes.clip);
  out.set(e('variants/shirt-mismatched-rig.glb'), bytes.mismatch);
  out.set(e('variants/five-influence.glb'), bytes.five);
  out.set(e('character.valid.json'), characterJson);

  // Schema fixtures: valid documents and malformed ones.
  const s = (p: string) => `${SCHEMA_DIR}/${p}`;
  out.set(s('rigs/fixture-ue5-22.json'), rigJson);
  out.set(s('rigs/fixture-ue5-22-x.json'), rigXJson);
  out.set(s('manifest.valid.json'), manifestJson);
  out.set(s('clips.valid.json'), clipsJson);
  out.set(s('character.valid.json'), characterJson);

  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  const bad = async (name: string, value: unknown) =>
    out.set(s(`malformed/${name}.json`), await json(value));

  const noAuthor = clone(manifest);
  delete (noAuthor.license as {author?: string}).author;
  await bad('manifest-missing-license-author', noAuthor);
  const dup = clone(manifest);
  dup.parts.push(clone(dup.parts[1] as PartEntry));
  await bad('manifest-duplicate-part-id', dup);
  const unknownRig = clone(manifest);
  (unknownRig.parts[1] as PartEntry).rig = 'no-such-rig';
  await bad('manifest-unknown-rig', unknownRig);
  const badGroup = clone(manifest);
  (badGroup.parts[1] as PartEntry).skeletonGroup = 'no-such-group';
  await bad('manifest-unknown-skeleton-group', badGroup);
  const wrongFormat = clone(manifest) as Record<string, unknown>;
  wrongFormat['format'] = 'sprite-clips-manifest';
  await bad('manifest-wrong-format', wrongFormat);
  const noRig = clone(manifest);
  delete (noRig.parts[1] as Partial<PartEntry>).rig;
  await bad('manifest-skinned-without-rig', noRig);
  const noGroup = clone(clips);
  delete (noGroup.clips[0] as Partial<(typeof clips.clips)[0]>).skeletonGroup;
  await bad('clips-missing-skeleton-group', noGroup);
  const noBody = clone(character) as Record<string, unknown>;
  delete noBody['body'];
  await bad('character-missing-body', noBody);
  await bad('character-future-version', {...clone(character), version: 99});
  await bad('character-bad-tint', {
    ...clone(character),
    tints: {...tints, skin: 'red'},
  });
  await bad('character-body-in-parts', {
    ...clone(character),
    parts: {body: {ref: `builtin:${PACK_ID}/fixture-body`}},
  });
  out.set(s('malformed/manifest-truncated.txt'), manifestJson.slice(0, 200));

  return new Map([...out].sort(([a], [b]) => (a < b ? -1 : 1)));
}
