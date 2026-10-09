import {Matrix4, Quaternion, Vector3} from 'three';
import {describe, expect, it} from 'vitest';
import {restWorldPositions} from '../retarget/fk';
import type {RestPose} from '../retarget/types';
import {createBodySkeleton} from './body-skeleton';
import {loadFixtureRig} from './test-fixtures';

const rig = loadFixtureRig();

/** Independent FK: compose every local rest TRS from the rig JSON down the parent chain. */
function fkWorld(groupId: string): Map<string, Matrix4> {
  const group = rig.skeletonGroups.find(g => g.id === groupId);
  if (group === undefined) throw new Error(groupId);
  const out = new Map<string, Matrix4>();
  for (const name of rig.bones) {
    const t = group.restPose[name];
    if (t === undefined) throw new Error(name);
    const local = new Matrix4().compose(
      new Vector3(...t.t),
      new Quaternion(...t.r),
      new Vector3(...t.s),
    );
    const parent = rig.parents[name] ?? null;
    const world =
      parent === null
        ? local
        : new Matrix4().multiplyMatrices(
            out.get(parent) ?? new Matrix4(),
            local,
          );
    out.set(name, world);
  }
  return out;
}

function maxAbsDiff(a: readonly number[], b: readonly number[]): number {
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    max = Math.max(max, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  }
  return max;
}

describe('createBodySkeleton', () => {
  it('M1-21 / AC-CMP-037.1: built from fixture-a (g-a) rest, bone world matrices = FK of rest TRS within 1e-6', () => {
    const result = createBodySkeleton(rig, 'fixture-a');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const body = result.value;
    expect(body.skeletonGroupId).toBe('fixture-a');
    expect(body.skeleton.bones.map(b => b.name)).toEqual(rig.bones);
    const expected = fkWorld('fixture-a');
    for (const name of rig.bones) {
      const bone = body.bones.get(name);
      expect(bone, name).toBeDefined();
      if (bone === undefined) continue;
      const want = expected.get(name);
      if (want === undefined) throw new Error(name);
      expect(
        maxAbsDiff(bone.matrixWorld.elements, want.elements),
        name,
      ).toBeLessThanOrEqual(1e-6);
    }
    // Cross-check positions against the three-free retarget FK.
    for (const [name, p] of restWorldPositions(body.rest)) {
      const bone = body.bones.get(name);
      if (bone === undefined) throw new Error(name);
      const w = new Vector3().setFromMatrixPosition(bone.matrixWorld);
      expect(maxAbsDiff(w.toArray(), [...p]), name).toBeLessThanOrEqual(1e-6);
    }
  });

  it('AC-CMP-037.1: every joint local rest transform equals the restPose of fixture-b (g-b) within 1e-6', () => {
    const result = createBodySkeleton(rig, 'fixture-b');
    if (!result.ok) throw new Error(result.error.message);
    const group = rig.skeletonGroups.find(g => g.id === 'fixture-b');
    for (const [name, bone] of result.value.bones) {
      const t = group?.restPose[name];
      if (t === undefined) throw new Error(name);
      expect(
        maxAbsDiff(bone.position.toArray(), t.t),
        name,
      ).toBeLessThanOrEqual(1e-6);
      expect(
        maxAbsDiff(bone.quaternion.toArray(), t.r),
        name,
      ).toBeLessThanOrEqual(1e-6);
      expect(maxAbsDiff(bone.scale.toArray(), t.s), name).toBeLessThanOrEqual(
        1e-6,
      );
    }
    // Spot check of the documented g-b delta: pelvis rest 0.05 m higher.
    expect(result.value.bones.get('pelvis')?.position.y).toBeCloseTo(0.92, 6);
  });

  it('AC-CMP-037.4: the rig default group builds the same skeleton as its id', () => {
    const result = createBodySkeleton(rig, rig.defaultSkeletonGroup);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.skeletonGroupId).toBe(rig.defaultSkeletonGroup);
  });

  it('REQ-CMP-037: accepts a RestPose (contract signature) and computes boneInverses from rest', () => {
    const fromId = createBodySkeleton(rig, 'fixture-b');
    if (!fromId.ok) throw new Error(fromId.error.message);
    const result = createBodySkeleton(rig, fromId.value.rest);
    if (!result.ok) throw new Error(result.error.message);
    const {skeleton} = result.value;
    skeleton.bones.forEach((bone, i) => {
      const product = new Matrix4().multiplyMatrices(
        bone.matrixWorld,
        skeleton.boneInverses[i] ?? new Matrix4(),
      );
      expect(
        maxAbsDiff(product.elements, new Matrix4().elements),
      ).toBeLessThanOrEqual(1e-6);
    });
    expect(result.value.root.children).toEqual([
      result.value.bones.get(rig.rootBone),
    ]);
  });

  it('REQ-CMP-037: is deterministic (same input, same matrices)', () => {
    const a = createBodySkeleton(rig, 'fixture-a');
    const b = createBodySkeleton(rig, 'fixture-a');
    if (!a.ok || !b.ok) throw new Error('build failed');
    a.value.skeleton.bones.forEach((bone, i) => {
      expect(bone.matrixWorld.elements).toEqual(
        b.value.skeleton.bones[i]?.matrixWorld.elements,
      );
    });
  });

  it('AST_RIG_MISMATCH: unknown group, or a rest pose missing a rig bone', () => {
    const unknown = createBodySkeleton(rig, 'no-such-group');
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe('AST_RIG_MISMATCH');

    const full = createBodySkeleton(rig, 'fixture-a');
    if (!full.ok) throw new Error(full.error.message);
    const partial: RestPose = {
      id: 'partial',
      joints: full.value.rest.joints.filter(j => j.name !== 'hand_r'),
    };
    const missing = createBodySkeleton(rig, partial);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.code).toBe('AST_RIG_MISMATCH');
      expect(missing.error.details?.['missing']).toEqual(['hand_r']);
    }

    const reparented: RestPose = {
      id: 'reparented',
      joints: full.value.rest.joints.map(j =>
        j.name === 'hand_r' ? {...j, parent: 'upperarm_r'} : j,
      ),
    };
    const wrong = createBodySkeleton(rig, reparented);
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.details?.['parents']).toEqual(['hand_r']);
  });
});
