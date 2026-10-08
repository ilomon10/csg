import {describe, expect, it} from 'vitest';
import {deriveRigDefinition} from './rig-verify.js';
import type {
  JointRest,
  RigOverlay,
  SkeletonData,
  SkeletonGroupInput,
} from './rig-verify.js';

const NAMES: Array<[string, string | null, [number, number, number]]> = [
  ['root', null, [0, 0, 0]],
  ['pelvis', 'root', [0, 1, 0]],
  ['spine_01', 'pelvis', [0, 0.2, 0]],
  ['hand_r', 'spine_01', [-0.3, 0.2, 0]],
  ['lowerarm_l', 'spine_01', [0.3, 0.2, 0]],
];

/** Translation-only skeleton; inverse bind is the negated world translation. */
function skeleton(): SkeletonData {
  const joints: JointRest[] = NAMES.map(([name, parent, t]) => ({
    name,
    parent,
    translation: t,
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
  }));
  const world = new Map<string, [number, number, number]>();
  const inverseBind = joints.map(j => {
    const p = j.parent ? world.get(j.parent) : undefined;
    const w: [number, number, number] = [
      (p?.[0] ?? 0) + j.translation[0],
      (p?.[1] ?? 0) + j.translation[1],
      (p?.[2] ?? 0) + j.translation[2],
    ];
    world.set(j.name, w);
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -w[0], -w[1], -w[2], 1];
  });
  return {
    joints,
    inverseBind,
    armatureWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  };
}

const overlay: RigOverlay = {
  defaultSkeletonGroup: 'g-a',
  socketBones: {
    hand_r: 'hand_r',
    hand_l: 'lowerarm_l',
    head: 'spine_01',
    spine_03: 'spine_01',
    pelvis: 'pelvis',
  },
  skeletonGroups: {'g-a': 'a.gltf'},
  anatomyBones: Object.fromEntries(
    [
      'height',
      'head',
      'torsoWidth',
      'shoulders',
      'armLength',
      'legLength',
      'hands',
      'feet',
      'limbThickness',
    ].map(k => [k, ['pelvis']]),
  ),
  regionBones: {
    head: [],
    hair: [],
    neck: [],
    torso: ['spine_01', 'lowerarm_l'],
    'upper-arms': [],
    'lower-arms': [],
    hands: ['hand_r'],
    pelvis: ['root', 'pelvis'],
    'upper-legs': [],
    'lower-legs': [],
    feet: [],
  },
};

describe('canonical rig output (--write-canonical derivation)', () => {
  it('AC-AST-005.2: parents mirror the hierarchy with one null root; defaultSkeletonGroup set; no hipBone or joints', () => {
    const ref = skeleton();
    const groups: SkeletonGroupInput[] = [
      {id: 'g-a', packId: 'p', file: 'a.gltf', skeleton: ref},
    ];
    const {rig, errors} = deriveRigDefinition('test-rig', ref, overlay, groups);
    expect(errors).toEqual([]);
    expect(rig).not.toBeNull();
    const out = rig as unknown as Record<string, unknown>;
    const parents = out['parents'] as Record<string, string | null>;
    expect(Object.keys(parents).sort()).toEqual(
      [...(out['bones'] as string[])].sort(),
    );
    for (const [name, parent] of NAMES) expect(parents[name]).toBe(parent);
    expect(Object.values(parents).filter(p => p === null)).toHaveLength(1);
    expect(parents[out['rootBone'] as string]).toBeNull();
    expect(out['defaultSkeletonGroup']).toBe('g-a');
    expect('hipBone' in out).toBe(false);
    expect('joints' in out).toBe(false);
  });
});
