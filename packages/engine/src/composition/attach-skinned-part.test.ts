import {AnimationMixer, Vector3} from 'three';
import type {SkinnedMesh} from 'three';
import {describe, expect, it} from 'vitest';
import type {AttachedPart, BodySkeleton} from '../contracts/composition';
import type {LoadedPartInternal} from '../contracts/registry';
import {attachSkinnedPart} from './attach-skinned-part';
import {createBodySkeleton} from './body-skeleton';
import {
  fixtureEntry,
  loadFixtureManifest,
  loadFixturePart,
  loadFixtureRig,
  parseFixtureGlb,
  readInverseBindMatrices,
} from './test-fixtures';

const rig = loadFixtureRig();
const manifest = loadFixtureManifest();
const SHIRT = 'pack/parts/fixture-shirt.glb';
const SHIRT_B = 'pack/parts/fixture-shirt-b.glb';
const BODY = 'pack/parts/fixture-body.glb';

function body(group: string): BodySkeleton {
  const result = createBodySkeleton(rig, group);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function attach(part: LoadedPartInternal, b: BodySkeleton): AttachedPart {
  const result = attachSkinnedPart(part, b);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function skinnedMeshes(part: {
  object: {traverse: AttachedPart['object']['traverse']};
}): SkinnedMesh[] {
  const out: SkinnedMesh[] = [];
  part.object.traverse(o => {
    if ((o as Partial<SkinnedMesh>).isSkinnedMesh === true)
      out.push(o as SkinnedMesh);
  });
  return out;
}

function sourceMesh(part: LoadedPartInternal): SkinnedMesh {
  let found: SkinnedMesh | undefined;
  part.scene.traverse(o => {
    if ((o as Partial<SkinnedMesh>).isSkinnedMesh === true)
      found = o as SkinnedMesh;
  });
  if (found === undefined) throw new Error('no skinned mesh in fixture');
  return found;
}

/** Max distance between each skinned vertex (world) and its bind-pose position. */
function maxBindDeviation(mesh: SkinnedMesh): number {
  mesh.updateMatrixWorld(true);
  mesh.skeleton.update();
  const position = mesh.geometry.getAttribute('position');
  const v = new Vector3();
  const bind = new Vector3();
  let max = 0;
  for (let i = 0; i < position.count; i++) {
    mesh.getVertexPosition(i, v);
    v.applyMatrix4(mesh.matrixWorld);
    bind.fromBufferAttribute(position, i);
    max = Math.max(max, v.distanceTo(bind));
  }
  return max;
}

describe('attachSkinnedPart', () => {
  it('M1-21 / AC-CMP-037.2: a fixture-b (g-b) shirt rebound to a g-b skeleton keeps its boneInverses (reference and file values) and rests at bind pose', async () => {
    const part = await loadFixturePart(
      SHIRT_B,
      fixtureEntry(manifest, 'fixture-shirt-b'),
      rig,
    );
    const source = sourceMesh(part);
    const sourceInverses = [...source.skeleton.boneInverses];
    const b = body('fixture-b');
    const attached = attach(part, b);
    const [mesh] = skinnedMeshes(attached);
    if (mesh === undefined) throw new Error('nothing attached');

    // Identity by reference: the very same Matrix4 objects, same order.
    expect(mesh.skeleton.boneInverses).toHaveLength(sourceInverses.length);
    mesh.skeleton.boneInverses.forEach((m, i) =>
      expect(m).toBe(sourceInverses[i]),
    );
    // Identity by value: bit-identical to the float32 accessor in the file.
    const file = readInverseBindMatrices(SHIRT_B);
    mesh.skeleton.boneInverses.forEach((m, i) => {
      expect(Array.from(m.elements)).toEqual(Array.from(file[i] ?? []));
    });
    // Bones are the character skeleton's bones, matched by name.
    mesh.skeleton.bones.forEach((bone, i) => {
      expect(bone).toBe(b.bones.get(source.skeleton.bones[i]?.name ?? ''));
    });
    // The registry-owned scene is untouched.
    expect(source.skeleton.boneInverses).toEqual(sourceInverses);
    expect(source.parent).not.toBeNull();
    // No clip, default anatomy: every vertex at its bind position (± 1e-5 m).
    expect(maxBindDeviation(mesh)).toBeLessThanOrEqual(1e-5);
  });

  it('REQ-CMP-037: the fixture-a shirt and body rest at bind pose on a fixture-a skeleton', async () => {
    const b = body('fixture-a');
    for (const [path, id] of [
      [SHIRT, 'fixture-shirt'],
      [BODY, 'fixture-body'],
    ] as const) {
      const part = await loadFixturePart(path, fixtureEntry(manifest, id), rig);
      const [mesh] = skinnedMeshes(attach(part, b));
      if (mesh === undefined) throw new Error(id);
      expect(maxBindDeviation(mesh), id).toBeLessThanOrEqual(1e-5);
    }
  });

  it('REQ-CMP-037: a g-b shirt on a g-a skeleton keeps its own IBMs (bind delta applied by LBS, no failure)', async () => {
    const part = await loadFixturePart(
      SHIRT_B,
      fixtureEntry(manifest, 'fixture-shirt-b'),
      rig,
    );
    const result = attachSkinnedPart(part, body('fixture-a'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [mesh] = skinnedMeshes(result.value);
    if (mesh === undefined) throw new Error('nothing attached');
    mesh.skeleton.boneInverses.forEach((m, i) =>
      expect(m).toBe(sourceMesh(part).skeleton.boneInverses[i]),
    );
    // The g-b pelvis is 0.05 m higher than g-a, so the shirt moves down by about that much.
    expect(maxBindDeviation(mesh)).toBeGreaterThan(0.04);
  });

  it('AC-CMP-006.1: a body from pack A and a torso from pack B share the body skeleton and play one clip together', async () => {
    const b = body('fixture-a');
    const bodyPart = await loadFixturePart(
      BODY,
      fixtureEntry(manifest, 'fixture-body'),
      rig,
      'builtin:pack-a/fixture-body',
    );
    const shirtPart = await loadFixturePart(
      SHIRT,
      fixtureEntry(manifest, 'fixture-shirt'),
      rig,
      'builtin:pack-b/fixture-shirt',
    );
    const bodyAttached = attach(bodyPart, b);
    const shirtAttached = attach(shirtPart, b);
    expect(bodyAttached.object.parent).toBe(b.root);
    expect(shirtAttached.object.parent).toBe(b.root);
    const meshes = [
      ...skinnedMeshes(bodyAttached),
      ...skinnedMeshes(shirtAttached),
    ];
    expect(meshes).toHaveLength(2);
    for (const mesh of meshes) {
      for (const bone of mesh.skeleton.bones)
        expect(b.bones.get(bone.name)).toBe(bone);
    }

    // Rest positions of vertices driven only by spine bones, per mesh.
    const spine = new Set(
      ['spine_01', 'spine_02', 'spine_03'].map(n => rig.bones.indexOf(n)),
    );
    const sample = (mesh: SkinnedMesh) => {
      b.root.updateMatrixWorld(true);
      mesh.skeleton.update();
      const index = mesh.geometry.getAttribute('skinIndex');
      const weight = mesh.geometry.getAttribute('skinWeight');
      const out = new Map<number, Vector3>();
      for (let i = 0; i < index.count; i++) {
        let onSpine = true;
        for (let k = 0; k < 4; k++) {
          const w = weight.getComponent(i, k);
          const boneIndex = index.getComponent(i, k);
          const bone = mesh.skeleton.bones[boneIndex];
          if (w > 0 && !spine.has(rig.bones.indexOf(bone?.name ?? '')))
            onSpine = false;
        }
        if (onSpine) out.set(i, mesh.getVertexPosition(i, new Vector3()));
      }
      return out;
    };
    const before = meshes.map(sample);
    for (const s of before) expect(s.size).toBeGreaterThan(0);

    // Play the fixture clip (root +0.5 m Z, pelvis (0, 0.92, 0.1) at t = 0.5 s) on the body.
    const clipGltf = await parseFixtureGlb('pack/clips/fixture-clip.glb');
    const clip = clipGltf.animations.find(a => a.name === 'fixture-clip');
    if (clip === undefined) throw new Error('no clip');
    const mixer = new AnimationMixer(b.root);
    mixer.clipAction(clip).play();
    mixer.setTime(0.5);

    // pelvis local goes from g-a rest (0, 0.87, 0) to (0, 0.92, 0.1); root moves (0, 0, 0.5).
    const expected = new Vector3(0, 0.05, 0.6);
    meshes.forEach((mesh, m) => {
      const after = sample(mesh);
      for (const [i, p] of before[m] ?? []) {
        const delta = (after.get(i) ?? new Vector3()).sub(p);
        expect(
          delta.distanceTo(expected),
          `mesh ${m} vertex ${i}`,
        ).toBeLessThanOrEqual(1e-5);
      }
    });
  });

  it('AC-AST-022.2 (engine side): a part skinned to a different rig (hand_r renamed Hand_R) yields AST_RIG_MISMATCH with details.missing', async () => {
    const part = await loadFixturePart(
      'variants/shirt-mismatched-rig.glb',
      fixtureEntry(manifest, 'fixture-shirt'),
      rig,
    );
    const b = body('fixture-a');
    const result = attachSkinnedPart(part, b);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('AST_RIG_MISMATCH');
    expect(result.error.details?.['missing']).toEqual(['Hand_R']);
    expect(b.root.children).toHaveLength(1); // only the root bone, nothing attached
  });

  it('AC-ANA-020.2: a part whose skin uses joint Head binds to Head and reports no AST_RIG_MISMATCH', async () => {
    const part = await loadFixturePart(
      SHIRT,
      fixtureEntry(manifest, 'fixture-shirt'),
      rig,
    );
    expect(sourceMesh(part).skeleton.bones.map(b => b.name)).toContain('Head');
    const b = body('fixture-a');
    const result = attachSkinnedPart(part, b);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [mesh] = skinnedMeshes(result.value);
    expect(mesh?.skeleton.bones).toContain(b.bones.get('Head'));
  });

  it('REQ-CMP-037: an explicit bone map (target -> part name) rebinds the renamed joint', async () => {
    const part = await loadFixturePart(
      'variants/shirt-mismatched-rig.glb',
      fixtureEntry(manifest, 'fixture-shirt'),
      rig,
    );
    const b = body('fixture-a');
    const result = attachSkinnedPart(part, b, {
      boneMap: new Map([['hand_r', 'Hand_R']]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [mesh] = skinnedMeshes(result.value);
    expect(mesh?.skeleton.bones).toContain(b.bones.get('hand_r'));
  });

  it('AST_RIG_MISMATCH: a hierarchy difference is reported in details.parents', async () => {
    const part = await loadFixturePart(
      SHIRT,
      fixtureEntry(manifest, 'fixture-shirt'),
      rig,
    );
    const src = sourceMesh(part);
    const hand = src.skeleton.bones.find(bone => bone.name === 'hand_r');
    const upper = src.skeleton.bones.find(bone => bone.name === 'upperarm_r');
    if (hand === undefined || upper === undefined) throw new Error('fixture');
    upper.add(hand);
    const result = attachSkinnedPart(part, body('fixture-a'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.details?.['missing']).toEqual([]);
      expect(result.error.details?.['parents']).toEqual([
        {bone: 'hand_r', expected: 'lowerarm_r', actual: 'upperarm_r'},
      ]);
    }
  });

  it('AST_RIG_MISMATCH: a part without a skinned mesh', async () => {
    const sword = await loadFixturePart(
      'pack/parts/fixture-sword.glb',
      fixtureEntry(manifest, 'fixture-sword'),
      rig,
    );
    const result = attachSkinnedPart(sword, body('fixture-a'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AST_RIG_MISMATCH');
  });

  it('setVisible toggles the part; dispose detaches it, idempotently, keeping shared resources', async () => {
    const part = await loadFixturePart(
      SHIRT,
      fixtureEntry(manifest, 'fixture-shirt'),
      rig,
    );
    const b = body('fixture-a');
    const attached = attach(part, b);
    attached.setVisible(false);
    expect(attached.object.visible).toBe(false);
    attached.setVisible(true);
    expect(attached.object.visible).toBe(true);
    attached.dispose();
    attached.dispose();
    expect(attached.object.parent).toBeNull();
    expect(b.root.children).toHaveLength(1);
    // Geometry is still usable by another attachment.
    const again = attach(part, b);
    expect(skinnedMeshes(again)[0]?.geometry).toBe(sourceMesh(part).geometry);
  });
});
