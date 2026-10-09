import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {NodeIO} from '@gltf-transform/core';
import type {Document} from '@gltf-transform/core';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {runBuildDetailed} from '../../build-parts.js';
import {buildClip} from '../../fixtures/fixture-models.js';
import {
  FIXTURE_RIG_ID,
  buildRigDefinition,
} from '../../fixtures/fixture-rig.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'run-build-'));
});
afterEach(() => rmSync(root, {recursive: true, force: true}));

function put(rel: string, data: string | Uint8Array): void {
  const p = join(root, rel);
  mkdirSync(dirname(p), {recursive: true});
  writeFileSync(p, data);
}

/** A temp repo with the fixture rig, one clip-only pack `p` and the given clip source. */
async function repoWithClip(source: Document): Promise<void> {
  put(
    `packages/parts-schema/rigs/${FIXTURE_RIG_ID}.json`,
    JSON.stringify(buildRigDefinition('y')),
  );
  put(
    'tools/packs/p/pack.config.json',
    JSON.stringify({
      format: 'sprite-pack-config',
      version: 1,
      packId: 'p',
      name: 'P',
      license: {
        license: 'CC0-1.0',
        author: 'A',
        sourceUrl: 'https://example.com',
        commercialUse: 'yes',
        attributionRequired: false,
      },
      rig: FIXTURE_RIG_ID,
      parts: [],
      clips: [
        {
          id: 'odd-clip',
          match: {file: 'clip.glb', animation: 'fixture-clip'},
          name: 'Odd clip',
          category: 'locomotion',
          loop: true,
          defaultFrameCount: 8,
          tags: [],
        },
      ],
    }),
  );
  put(
    'tools/asset-sources.json',
    JSON.stringify({
      packs: [
        {
          packId: 'p',
          name: 'P',
          vendorUrl: 'https://v',
          tier: 'standard',
          dir: 'src-pack',
        },
      ],
    }),
  );
  put('assets-src/src-pack/clip.glb', await new NodeIO().writeBinary(source));
}

const build = () =>
  runBuildDetailed({
    packs: [],
    root,
    src: join(root, 'assets-src'),
    out: join(root, 'assets/packs'),
  });

describe('assets:build end to end on a clip-only fixture pack', () => {
  it('AC-AST-026.6: a clip whose rest pose matches no skeleton group builds (exit 0), warns AST_CLIP_GROUP_DEFAULTED naming the clip and the default group, and records that group', async () => {
    const doc = buildClip();
    const pelvis = doc
      .getRoot()
      .listNodes()
      .find(n => n.getName() === 'pelvis');
    if (pelvis === undefined) throw new Error('fixture clip has no pelvis');
    const [x, y, z] = pelvis.getTranslation();
    pelvis.setTranslation([x + 0.3, y + 0.3, z + 0.3]);
    await repoWithClip(doc);
    const result = await build();
    const rig = buildRigDefinition('y');
    const warning = result.warnings.find(
      w => w.code === 'AST_CLIP_GROUP_DEFAULTED',
    );
    expect(warning?.message).toContain('odd-clip');
    expect(warning?.message).toContain(rig.defaultSkeletonGroup);
    const clips = JSON.parse(
      readFileSync(join(root, 'assets/packs/p/clips.json'), 'utf8'),
    ) as {clips: Array<{id: string; skeletonGroup?: string}>};
    expect(clips.clips.find(c => c.id === 'odd-clip')?.skeletonGroup).toBe(
      rig.defaultSkeletonGroup,
    );
  });

  it('AC-AST-016.3: a built clip over 3 MiB (3,145,728 bytes) builds (exit 0) and warns AST_BUDGET_FILE_SIZE naming the clip, its size and the limit', async () => {
    const doc = buildClip();
    // Incompressible keyframes on one joint push the built file past the budget. The exact
    // 3,145,729-byte boundary is not reproducible from a synthetic source; the check is `> limit`.
    const buffer = doc.getRoot().listBuffers()[0];
    const pelvis = doc
      .getRoot()
      .listNodes()
      .find(n => n.getName() === 'pelvis');
    if (buffer === undefined || pelvis === undefined)
      throw new Error('fixture');
    const keys = 400_000;
    let seed = 12345;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const times = new Float32Array(keys);
    const values = new Float32Array(keys * 3);
    for (let i = 0; i < keys; i++) {
      times[i] = i / 1000;
      values[i * 3] = rand();
      values[i * 3 + 1] = rand();
      values[i * 3 + 2] = rand();
    }
    const anim = doc.getRoot().listAnimations()[0];
    if (anim === undefined) throw new Error('fixture');
    const sampler = doc
      .createAnimationSampler()
      .setInterpolation('LINEAR')
      .setInput(
        doc
          .createAccessor()
          .setType('SCALAR')
          .setArray(times)
          .setBuffer(buffer),
      )
      .setOutput(
        doc.createAccessor().setType('VEC3').setArray(values).setBuffer(buffer),
      );
    const hand = doc
      .getRoot()
      .listNodes()
      .find(n => n.getName() === 'hand_l');
    if (hand === undefined) throw new Error('fixture');
    anim
      .addSampler(sampler)
      .addChannel(
        doc
          .createAnimationChannel()
          .setTargetNode(hand)
          .setTargetPath('translation')
          .setSampler(sampler),
      );
    await repoWithClip(doc);
    const result = await build();
    const warning = result.warnings.find(
      w => w.code === 'AST_BUDGET_FILE_SIZE',
    );
    expect(warning?.partId).toBe('odd-clip');
    expect(warning?.message).toContain('odd-clip');
    expect(warning?.message).toContain('3145728');
    const size = /: (\d+) bytes/.exec(warning?.message ?? '')?.[1];
    expect(Number(size)).toBeGreaterThan(3 * 1024 * 1024);
    expect(result.summary).toContain('AST_BUDGET_FILE_SIZE');
  }, 120_000);
});
