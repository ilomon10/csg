import {existsSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import type {Node} from '@gltf-transform/core';
import {
  BODY_REGIONS,
  parseCharacterSpec,
  parseClipManifest,
  parseJson,
  parsePartManifest,
  rigDefinitionSchema,
  validatePartsAgainstRig,
} from '@csg/parts-schema';
import {beforeAll, describe, expect, it} from 'vitest';
import {
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  buildFixtures,
  ENGINE_DIR,
  SCHEMA_DIR,
} from './build-fixtures.js';
import type {FixtureFiles} from './build-fixtures.js';
import {
  GROUP_A,
  GROUP_B,
  buildRigDefinition,
  legLength,
  restPoseOf,
} from './fixture-rig.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const text = (files: FixtureFiles, path: string): string => {
  const v = files.get(path);
  if (typeof v !== 'string') throw new Error(`no text fixture ${path}`);
  return v;
};
const bytes = (files: FixtureFiles, path: string): Uint8Array => {
  const v = files.get(path);
  if (!(v instanceof Uint8Array)) throw new Error(`no binary fixture ${path}`);
  return v;
};
const E = (p: string) => `${ENGINE_DIR}/${p}`;
const S = (p: string) => `${SCHEMA_DIR}/${p}`;

let files: FixtureFiles;
beforeAll(async () => {
  files = await buildFixtures();
});

describe('AC-AST-021.1 fixture size and determinism', () => {
  it('keeps every file <= 200 KB and the total <= 300 KB', () => {
    let total = 0;
    for (const [path, content] of files) {
      const size =
        typeof content === 'string'
          ? Buffer.byteLength(content)
          : content.length;
      expect(size, path).toBeLessThanOrEqual(MAX_FILE_BYTES);
      total += size;
    }
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
  });

  it('is byte-identical on rerun', async () => {
    const again = await buildFixtures();
    expect([...again.keys()]).toEqual([...files.keys()]);
    for (const [path, content] of files) {
      expect(Buffer.from(again.get(path) as Uint8Array | string), path).toEqual(
        Buffer.from(content),
      );
    }
  });

  it('matches the committed files (run pnpm fixtures:build after changes)', () => {
    for (const [path, content] of files) {
      const abs = resolve(root, path);
      expect(existsSync(abs), path).toBe(true);
      expect(readFileSync(abs).equals(Buffer.from(content)), path).toBe(true);
    }
  });
});

describe('fixture rig', () => {
  it('parses with rigDefinitionSchema, has 22 bones, no hipBone, both groups', () => {
    for (const path of [
      E('rigs/fixture-ue5-22.json'),
      E('rigs/fixture-ue5-22-x.json'),
    ]) {
      const parsed = rigDefinitionSchema.safeParse(
        JSON.parse(text(files, path)),
      );
      expect(parsed.success, path).toBe(true);
    }
    const rig = buildRigDefinition('y');
    expect(rig.bones).toHaveLength(22);
    expect(rig.bones).toContain('Head');
    expect('hipBone' in rig).toBe(false);
    expect(rig.skeletonGroups.map(g => g.id)).toEqual([GROUP_A, GROUP_B]);
    expect(rig.defaultSkeletonGroup).toBe(GROUP_A);
  });

  it('AC-ANA-005.1 has an x-axis variant', () => {
    expect(buildRigDefinition('x').lengthAxis).toBe('x');
    expect(buildRigDefinition('y').lengthAxis).toBe('y');
  });

  it('documents the leg-length ratio in closed form (a/b = 174/215)', () => {
    const a = legLength(restPoseOf(GROUP_A));
    const b = legLength(restPoseOf(GROUP_B));
    expect(a).toBeCloseTo(0.87, 12);
    expect(b).toBeCloseTo(1.075, 12);
    expect(a / b).toBeCloseTo(174 / 215, 12);
  });

  it('AC-AST-026.1 groups differ in pelvis by 0.05 m', () => {
    const a = restPoseOf(GROUP_A)['pelvis']?.t[1] ?? 0;
    const b = restPoseOf(GROUP_B)['pelvis']?.t[1] ?? 0;
    expect(b - a).toBeCloseTo(0.05, 9);
  });
});

describe('schema parse of valid fixtures', () => {
  it('parses manifest, clips and character; embedded rig groups are valid', () => {
    const manifest = parsePartManifest(
      JSON.parse(text(files, S('manifest.valid.json'))),
    );
    expect(manifest.ok).toBe(true);
    if (manifest.ok) {
      expect(validatePartsAgainstRig(manifest.value).ok).toBe(true);
    }
    expect(
      parseClipManifest(JSON.parse(text(files, S('clips.valid.json')))).ok,
    ).toBe(true);
    expect(
      parseCharacterSpec(JSON.parse(text(files, S('character.valid.json')))).ok,
    ).toBe(true);
    expect(text(files, E('pack/manifest.json'))).toBe(
      text(files, S('manifest.valid.json')),
    );
  });
});

describe('malformed fixtures fail loudly', () => {
  const load = (name: string): unknown =>
    JSON.parse(text(files, S(`malformed/${name}.json`)));
  it('manifest problems name the part and field', () => {
    const noAuthor = parsePartManifest(load('manifest-missing-license-author'));
    expect(
      !noAuthor.ok && noAuthor.issues.some(i => i.field === 'author'),
    ).toBe(true);
    for (const name of [
      'manifest-duplicate-part-id',
      'manifest-unknown-rig',
      'manifest-wrong-format',
      'manifest-skinned-without-rig',
    ]) {
      expect(parsePartManifest(load(name)).ok, name).toBe(false);
    }
    const group = parsePartManifest(load('manifest-unknown-skeleton-group'));
    expect(group.ok).toBe(true);
    if (group.ok) {
      const r = validatePartsAgainstRig(group.value);
      expect(!r.ok && r.issues[0]?.field).toBe('skeletonGroup');
    }
  });
  it('clip and character problems', () => {
    expect(parseClipManifest(load('clips-missing-skeleton-group')).ok).toBe(
      false,
    );
    const noBody = parseCharacterSpec(load('character-missing-body'));
    expect(!noBody.ok && noBody.code).toBe('CMP_BODY_MISSING');
    for (const name of [
      'character-future-version',
      'character-bad-tint',
      'character-body-in-parts',
    ]) {
      const r = parseCharacterSpec(load(name));
      expect(!r.ok && r.code, name).toBe('CMP_SPEC_INVALID');
    }
  });
  it('truncated manifest is not JSON', () => {
    expect(
      parseJson(text(files, S('malformed/manifest-truncated.txt'))).ok,
    ).toBe(false);
  });
});

describe('glTF fixtures', () => {
  const io = new NodeIO();
  const read = async (path: string) => io.readBinary(bytes(files, E(path)));

  it('AC-AST-025.1 body has _REGION as UNSIGNED_BYTE SCALAR, hands = 6', async () => {
    const prim = (await read('pack/parts/fixture-body.glb'))
      .getRoot()
      .listMeshes()[0]
      ?.listPrimitives()[0];
    const region = prim?.getAttribute('_REGION');
    expect(region?.getComponentType()).toBe(5121);
    expect(region?.getType()).toBe('SCALAR');
    expect(region?.getNormalized()).toBe(false);
    const w = prim?.getAttribute('WEIGHTS_0');
    const j = prim?.getAttribute('JOINTS_0');
    const hand = BODY_REGIONS.indexOf('hands');
    const joints =
      (await read('pack/parts/fixture-body.glb'))
        .getRoot()
        .listSkins()[0]
        ?.listJoints() ?? [];
    let seen = 0;
    for (let v = 0; v < (region?.getCount() ?? 0); v++) {
      const jt = j?.getElement(v, []) ?? [];
      const wt = w?.getElement(v, []) ?? [];
      const name = joints[jt[0] ?? 0]?.getName();
      if (name === 'hand_l' && (wt[0] ?? 0) >= 0.5) {
        expect(region?.getScalar(v)).toBe(hand);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(0);
    for (let v = 0; v < (region?.getCount() ?? 0); v++) {
      expect(region?.getScalar(v)).toBeLessThan(BODY_REGIONS.length);
    }
  });

  it('AC-AST-021.2 clip lowerarm_l at 0.5 s equals the documented key', async () => {
    const doc = await read('pack/clips/fixture-clip.glb');
    const anim = doc.getRoot().listAnimations()[0];
    expect(anim?.getName()).toBe('fixture-clip');
    const ch = anim
      ?.listChannels()
      .find(
        c =>
          c.getTargetNode()?.getName() === 'lowerarm_l' &&
          c.getTargetPath() === 'rotation',
      );
    const s = ch?.getSampler();
    expect(Array.from(s?.getInput()?.getArray() ?? [])).toEqual([0, 0.5, 1]);
    const q = s?.getOutput()?.getElement(1, []) ?? [];
    const d = Math.PI / 180;
    const [c5, s5, c15, s15] = [
      Math.cos(5 * d),
      Math.sin(5 * d),
      Math.cos(15 * d),
      Math.sin(15 * d),
    ];
    const expected = [c5 * s15, s5 * s15, s5 * c15, c5 * c15];
    expected.forEach((e, i) =>
      expect(Math.abs((q[i] ?? 0) - e)).toBeLessThanOrEqual(1e-6),
    );
    const rest = s?.getOutput()?.getElement(0, []) ?? [];
    expect(rest[2]).toBeCloseTo(s5, 6);
    const root = anim
      ?.listChannels()
      .find(c => c.getTargetNode()?.getName() === 'root');
    expect(root?.getSampler()?.getOutput()?.getElement(2, [])).toEqual([
      0, 0, 1,
    ]);
  });

  it('AC-AST-027.1 five-influence vertex', async () => {
    const prim = (await read('variants/five-influence.glb'))
      .getRoot()
      .listMeshes()[0]
      ?.listPrimitives()[0];
    const w0 = prim?.getAttribute('WEIGHTS_0')?.getElement(0, []) ?? [];
    const w1 = prim?.getAttribute('WEIGHTS_1')?.getElement(0, []) ?? [];
    [0.4, 0.3, 0.15, 0.1].forEach((e, i) => expect(w0[i]).toBeCloseTo(e, 6));
    expect(w1[0]).toBeCloseTo(0.05, 6);
    expect((prim?.getAttribute('WEIGHTS_1')?.getElement(1, []) ?? [])[0]).toBe(
      0,
    );
  });

  it('AC-AST-026.2 mismatched part renames hand_r; static sword has no skin', async () => {
    const names = (await read('variants/shirt-mismatched-rig.glb'))
      .getRoot()
      .listNodes()
      .map(n => n.getName());
    expect(names).toContain('Hand_R');
    expect(names).not.toContain('hand_r');
    expect(
      (await read('pack/parts/fixture-sword.glb')).getRoot().listSkins(),
    ).toHaveLength(0);
  });

  it('AC-AST-021.1 every skinned fixture has a mesh+skin node in its default scene', async () => {
    const skinned = [
      'pack/parts/fixture-body.glb',
      'pack/parts/fixture-shirt.glb',
      'pack/parts/fixture-shirt-b.glb',
      'variants/shirt-mismatched-rig.glb',
      'variants/five-influence.glb',
    ];
    for (const path of skinned) {
      const root = (await read(path)).getRoot();
      const scene = root.getDefaultScene();
      expect(scene, path).not.toBeNull();
      const inScene: Node[] = [];
      scene?.traverse(n => inScene.push(n));
      expect(
        inScene.some(n => n.getMesh() !== null && n.getSkin() !== null),
        path,
      ).toBe(true);
    }
    const sword = (await read('pack/parts/fixture-sword.glb')).getRoot();
    expect(sword.getDefaultScene()).not.toBeNull();
  });
});
