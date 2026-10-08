import {describe, expect, it} from 'vitest';
import {loadFixtureRig} from '../anatomy/test-skeleton';
import {
  checkParentOrder,
  restPoseForGroup,
  restWorldMatrices,
  subtreeJoints,
} from './index';
import {restWorldPositions} from '../retarget';
import {
  mat4Compose,
  mat4Decompose,
  mat4Identity,
  mat4Invert,
  mat4Multiply,
} from './index';

const rig = loadFixtureRig('fixture-ue5-22.json');

describe('rig helpers (REQ-ANA-021, REQ-ANA-003)', () => {
  it('looks up the rest pose by skeleton group in rig.bones order', () => {
    const b = restPoseForGroup(rig, 'fixture-b');
    expect(b?.id).toBe('fixture-b');
    expect(b?.joints.map(j => j.name)).toEqual(rig.bones);
    expect(b?.joints.find(j => j.name === 'pelvis')?.translation[1]).toBe(0.92);
    expect(restPoseForGroup(rig, 'nope')).toBeUndefined();
  });

  it('checkParentOrder accepts the fixture and reports broken hierarchies', () => {
    const rest = restPoseForGroup(rig, 'fixture-a');
    expect(rest).toBeDefined();
    if (rest === undefined) return;
    expect(checkParentOrder(rest)).toEqual([]);
    const swapped = {...rest, joints: [...rest.joints].reverse()};
    expect(checkParentOrder(swapped).length).toBeGreaterThan(0);
    const twoRoots = {
      ...rest,
      joints: rest.joints.map(j =>
        j.name === 'pelvis' ? {...j, parent: null} : j,
      ),
    };
    expect(checkParentOrder(twoRoots)).toContain(
      'expected exactly one root, found 2',
    );
  });

  it('subtreeJoints returns roots and descendants in rest order', () => {
    const rest = restPoseForGroup(rig, 'fixture-a');
    if (rest === undefined) throw new Error('missing');
    expect(subtreeJoints(rest, ['clavicle_l'])).toEqual([
      'clavicle_l',
      'upperarm_l',
      'lowerarm_l',
      'hand_l',
    ]);
  });

  it('restWorldMatrices agrees with restWorldPositions and applies local scales', () => {
    const rest = restPoseForGroup(rig, 'fixture-b');
    if (rest === undefined) throw new Error('missing');
    const m = restWorldMatrices(rest);
    const p = restWorldPositions(rest);
    for (const j of rest.joints) {
      const mat = m.get(j.name);
      const pos = p.get(j.name);
      expect(mat?.[12]).toBeCloseTo(pos?.[0] ?? NaN, 9);
      expect(mat?.[13]).toBeCloseTo(pos?.[1] ?? NaN, 9);
      expect(mat?.[14]).toBeCloseTo(pos?.[2] ?? NaN, 9);
    }
    const scaled = restWorldMatrices(rest, new Map([['pelvis', [1, 2, 1]]]));
    expect(scaled.get('spine_01')?.[13]).toBeCloseTo(0.92 + 0.2, 9);
  });

  it('restWorldMatrices places root joints under rootWorld', () => {
    const rest = restPoseForGroup(rig, 'fixture-b');
    if (rest === undefined) throw new Error('missing');
    const root = mat4Compose([0, 5, 0], [0, 0, 0, 1], [1, 1, 1]);
    const plain = restWorldMatrices(rest);
    const lifted = restWorldMatrices(rest, undefined, root);
    for (const j of rest.joints) {
      expect(lifted.get(j.name)?.[13]).toBeCloseTo(
        (plain.get(j.name)?.[13] ?? NaN) + 5,
        9,
      );
    }
  });
});

describe('rig matrix helpers', () => {
  it('compose, decompose and invert round-trip a TRS matrix', () => {
    const q: [number, number, number, number] = [
      Math.sin(0.3),
      0,
      0,
      Math.cos(0.3),
    ];
    const m = mat4Compose([1, 2, 3], q, [1, 2, 0.5]);
    const d = mat4Decompose(m);
    expect(d.translation).toEqual([1, 2, 3]);
    d.scale.forEach((v, i) => expect(v).toBeCloseTo([1, 2, 0.5][i] ?? NaN, 12));
    d.rotation.forEach((v, i) => expect(v).toBeCloseTo(q[i] ?? NaN, 12));
    const inv = mat4Invert(m);
    expect(inv).not.toBeNull();
    const id = mat4Multiply(m, inv ?? mat4Identity());
    id.forEach((v, i) => expect(v).toBeCloseTo(mat4Identity()[i] ?? NaN, 12));
    expect(mat4Invert(new Float64Array(16))).toBeNull();
  });
});
