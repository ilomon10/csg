/**
 * Synthetic rig `fixture-ue5-22` (spec 011 REQ-AST-021, plan 2.4): 22 joints with the canonical
 * UE5 names (including capitalised `Head`), two skeleton groups and a `lengthAxis: 'x'` variant.
 * Pure data and math; no I/O.
 */
import {BODY_REGIONS} from '@csg/parts-schema';
import type {BodyRegion, RigDefinition} from '@csg/parts-schema';
import {compose, multiply} from '../lib/mat4.js';
import type {Quat, Vec3} from '../lib/mat4.js';

/** Rig ID of the fixture rig. */
export const FIXTURE_RIG_ID = 'fixture-ue5-22';
/** Rig ID of the `lengthAxis: 'x'` variant (AC-ANA-005.1). */
export const FIXTURE_RIG_X_ID = 'fixture-ue5-22-x';
/** Group of the character skeleton (bodies, shirts). */
export const GROUP_A = 'fixture-a';
/** Group of the clip source skeleton. */
export const GROUP_B = 'fixture-b';

/** Rounds to 1e-9 so derived values print without float noise. */
export const round9 = (v: number): number => Math.round(v * 1e9) / 1e9;

interface BoneDef {
  name: string;
  parent: string | null;
  /** Local rest translation in group `fixture-a`. */
  t: Vec3;
}

const side = (s: 'l' | 'r'): BoneDef[] => {
  const x = s === 'l' ? 1 : -1;
  return [
    {name: `clavicle_${s}`, parent: 'spine_03', t: [0.08 * x, 0.12, 0]},
    {name: `upperarm_${s}`, parent: `clavicle_${s}`, t: [0.12 * x, 0, 0]},
    {name: `lowerarm_${s}`, parent: `upperarm_${s}`, t: [0, -0.28, 0]},
    {name: `hand_${s}`, parent: `lowerarm_${s}`, t: [0, -0.25, 0]},
  ];
};

const leg = (s: 'l' | 'r'): BoneDef[] => {
  const x = s === 'l' ? 1 : -1;
  return [
    {name: `thigh_${s}`, parent: 'pelvis', t: [0.09 * x, -0.05, 0]},
    {name: `calf_${s}`, parent: `thigh_${s}`, t: [0, -0.42, 0]},
    {name: `foot_${s}`, parent: `calf_${s}`, t: [0, -0.4, 0]},
  ];
};

/** Joints in hierarchy order (parents first) with the `fixture-a` rest translation. */
export const BONE_DEFS: readonly BoneDef[] = [
  {name: 'root', parent: null, t: [0, 0, 0]},
  {name: 'pelvis', parent: 'root', t: [0, 0.87, 0]},
  {name: 'spine_01', parent: 'pelvis', t: [0, 0.1, 0]},
  {name: 'spine_02', parent: 'spine_01', t: [0, 0.12, 0]},
  {name: 'spine_03', parent: 'spine_02', t: [0, 0.12, 0]},
  {name: 'neck_01', parent: 'spine_03', t: [0, 0.15, 0]},
  {name: 'Head', parent: 'neck_01', t: [0, 0.08, 0]},
  {name: 'Head_leaf', parent: 'Head', t: [0, 0.2, 0]},
  ...side('l'),
  ...side('r'),
  ...leg('l'),
  ...leg('r'),
];

/** Bone names in hierarchy order. */
export const BONES: readonly string[] = BONE_DEFS.map(b => b.name);

/** Parent of each bone (`null` for the root). */
export const PARENTS: Readonly<Record<string, string | null>> =
  Object.fromEntries(BONE_DEFS.map(b => [b.name, b.parent]));

/** Rotation about local Z by `deg` degrees (xyzw). */
export function rotZ(deg: number): Quat {
  const h = (deg * Math.PI) / 360;
  return [0, 0, Math.sin(h), Math.cos(h)];
}

/** Rotation about local X by `deg` degrees (xyzw). */
export function rotX(deg: number): Quat {
  const h = (deg * Math.PI) / 360;
  return [Math.sin(h), 0, 0, Math.cos(h)];
}

/** Hamilton product `a * b` of xyzw quaternions. */
export function quatMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Local rest transform of one joint. */
export interface Rest {
  t: Vec3;
  r: Quat;
  s: Vec3;
}

/** Group B: upper and lower arms +10 deg about Z, calves and feet translations x1.25, pelvis +0.05 m. */
export const ARM_BONES_B = [
  'upperarm_l',
  'upperarm_r',
  'lowerarm_l',
  'lowerarm_r',
] as const;

/** Rest pose of every bone for one group. */
export function restPoseOf(group: string): Record<string, Rest> {
  const isB = group === GROUP_B;
  return Object.fromEntries(
    BONE_DEFS.map(b => {
      let t: Vec3 = b.t;
      let r: Quat = [0, 0, 0, 1];
      if (isB) {
        if (b.name.startsWith('calf_') || b.name.startsWith('foot_')) {
          t = [b.t[0] * 1.25, b.t[1] * 1.25, b.t[2] * 1.25];
        }
        if (b.name === 'pelvis') t = [b.t[0], b.t[1] + 0.05, b.t[2]];
        if ((ARM_BONES_B as readonly string[]).includes(b.name)) r = rotZ(10);
      }
      return [
        b.name,
        {
          t: t.map(round9) as unknown as Vec3,
          r: r.map(round9) as unknown as Quat,
          s: [1, 1, 1] as Vec3,
        },
      ];
    }),
  );
}

/** World matrices (column-major) of every bone by forward kinematics over a rest pose. */
export function worldMatrices(
  rest: Record<string, Rest>,
): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const b of BONE_DEFS) {
    const r = rest[b.name];
    if (r === undefined) throw new Error(`no rest pose for ${b.name}`);
    const local = compose(r.t, r.r, r.s);
    const parent = b.parent === null ? undefined : out.get(b.parent);
    out.set(b.name, parent === undefined ? local : multiply(parent, local));
  }
  return out;
}

/** World position of every bone. */
export function worldPositions(rest: Record<string, Rest>): Map<string, Vec3> {
  return new Map(
    [...worldMatrices(rest)].map(([name, m]) => [
      name,
      [m[12] ?? 0, m[13] ?? 0, m[14] ?? 0] as Vec3,
    ]),
  );
}

/**
 * Leg length used by the retargeter (plan 2.6): `|world(pelvis) - mean(world(feet))|` over the
 * rest pose. Closed form here: A = 0.05 + 0.42 + 0.40 = 0.87, B = 0.05 + 0.525 + 0.50 = 1.075.
 */
export function legLength(rest: Record<string, Rest>): number {
  const w = worldPositions(rest);
  const get = (n: string): Vec3 => {
    const v = w.get(n);
    if (v === undefined) throw new Error(n);
    return v;
  };
  const p = get('pelvis');
  const l = get('foot_l');
  const r = get('foot_r');
  const m = [0, 1, 2].map(i => ((l[i] ?? 0) + (r[i] ?? 0)) / 2);
  return Math.hypot(p[0] - (m[0] ?? 0), p[1] - (m[1] ?? 0), p[2] - (m[2] ?? 0));
}

/** Body region of every joint (REQ-AST-012); `hair` has no bones. */
export const REGION_BONES: Readonly<Record<BodyRegion, readonly string[]>> = {
  head: ['Head', 'Head_leaf'],
  hair: [],
  neck: ['neck_01'],
  torso: ['spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r'],
  'upper-arms': ['upperarm_l', 'upperarm_r'],
  'lower-arms': ['lowerarm_l', 'lowerarm_r'],
  hands: ['hand_l', 'hand_r'],
  pelvis: ['root', 'pelvis'],
  'upper-legs': ['thigh_l', 'thigh_r'],
  'lower-legs': ['calf_l', 'calf_r'],
  feet: ['foot_l', 'foot_r'],
};

/** `_REGION` value (index into `BODY_REGIONS`, REQ-AST-025) of a bone. */
export function regionIndexOf(bone: string): number {
  const i = BODY_REGIONS.findIndex(region =>
    REGION_BONES[region].includes(bone),
  );
  if (i < 0) throw new Error(`bone ${bone} is in no region`);
  return i;
}

/** Builds the fixture RigDefinition (`lengthAxis: 'y'`) or its `x` variant. */
export function buildRigDefinition(axis: 'y' | 'x'): RigDefinition {
  const swap = axis === 'x';
  const groups = [GROUP_A, GROUP_B].map(id => {
    const rest = restPoseOf(id);
    return {
      id,
      restPose: Object.fromEntries(
        BONES.map(name => {
          const r = rest[name];
          if (r === undefined) throw new Error(name);
          // The x variant lays every bone along local X: swap the X and Y translation components.
          const t: [number, number, number] = swap
            ? [r.t[1], r.t[0], r.t[2]]
            : [r.t[0], r.t[1], r.t[2]];
          return [name, {t, r: [...r.r], s: [...r.s]}];
        }),
      ) as RigDefinition['skeletonGroups'][number]['restPose'],
    };
  });
  const top = worldPositions(restPoseOf(GROUP_A)).get('Head_leaf');
  return {
    id: swap ? FIXTURE_RIG_X_ID : FIXTURE_RIG_ID,
    comment: swap
      ? 'Synthetic fixture rig, bones laid out along local X (AC-ANA-005.1). Generated by pnpm fixtures:build.'
      : 'Synthetic fixture rig with canonical UE5 joint names. Generated by pnpm fixtures:build; see README.md.',
    bones: [...BONES],
    rootBone: 'root',
    lengthAxis: axis,
    anatomyBones: {
      height: ['root'],
      head: ['Head'],
      torsoWidth: ['spine_01', 'spine_02', 'spine_03'],
      shoulders: ['clavicle_l', 'clavicle_r'],
      armLength: ['upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r'],
      legLength: ['thigh_l', 'thigh_r', 'calf_l', 'calf_r'],
      hands: ['hand_l', 'hand_r'],
      feet: ['foot_l', 'foot_r'],
      limbThickness: [
        'upperarm_l',
        'upperarm_r',
        'lowerarm_l',
        'lowerarm_r',
        'thigh_l',
        'thigh_r',
        'calf_l',
        'calf_r',
      ],
    },
    regionBones: Object.fromEntries(
      BODY_REGIONS.map(region => [region, [...REGION_BONES[region]]]),
    ) as RigDefinition['regionBones'],
    socketBones: {
      hand_r: 'hand_r',
      hand_l: 'hand_l',
      head: 'Head',
      spine_03: 'spine_03',
      pelvis: 'pelvis',
    },
    skeletonHeightM: round9(top?.[1] ?? 1),
    parents: {...PARENTS},
    skeletonGroups: groups,
    defaultSkeletonGroup: GROUP_A,
  };
}
