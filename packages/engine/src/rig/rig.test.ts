import {describe, expect, it} from 'vitest';
import {loadFixtureRig} from '../anatomy/test-skeleton';
import {
  checkParentOrder,
  restPoseForGroup,
  restWorldMatrices,
  subtreeJoints,
} from './index';
import {restWorldPositions} from '../retarget';

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
});
