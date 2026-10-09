import {Matrix4, Vector3} from 'three';
import type {Object3D, Skeleton, SkinnedMesh} from 'three';
import {ANATOMY_PARAM_KEYS} from '@csg/parts-schema';
import type {AnatomyParams, SocketId} from '@csg/parts-schema';
import type {
  AnatomyBinding,
  AnatomyScales,
  ApplyAnatomy,
  ComputeGroundOffset,
} from '../contracts/anatomy';
import type {RestPose} from '../retarget';
import {restWorldMatrices} from '../rig';
import type {AnatomyPlan} from './plan';
import {SCALE_MODES, planOf} from './plan';

/** Result of one evaluation, cached per binding until the parameters change. */
interface Evaluation {
  /** Parameter values in `ANATOMY_PARAM_KEYS` order (the cache key). */
  readonly values: number[];
  readonly scales: Map<string, Vector3>;
  /** Target world scale per joint, xyz interleaved (see {@link applyAnatomy}). */
  readonly world: Float64Array;
  /**
   * Uniform world scale per joint: the product of the propagating factors
   * (`height`, `head`, `hands`, `feet`) of the joint and its ancestors.
   */
  readonly uniform: Float64Array;
  /**
   * Per joint, in rig order: the bone's uniform local scale factor (its own
   * propagating factor), the non-uniform own-frame factor of the compensated
   * parameters that skins its geometry ({@link anatomySkinScales}), and the
   * parent's own-frame factor that scales the joint's local translation.
   * Iterated by index in the per-frame path.
   */
  readonly poseList: ReadonlyArray<{
    readonly name: string;
    readonly boneScale: number;
    readonly skin: Vector3;
    /** `null` when the parent's own-frame factor is (1, 1, 1). */
    readonly parentSkin: Vector3 | null;
  }>;
  /** Own-frame skin factor per joint name (see {@link anatomySkinScales}). */
  readonly skinScales: Map<string, Vector3>;
  /** Uniform world factor per joint name (see {@link anatomyUniformScales}). */
  readonly uniformScales: Map<string, Vector3>;
  groundOffset: number | undefined;
}

const CACHE = new WeakMap<AnatomyBinding, Evaluation>();

function valuesOf(params: AnatomyParams): number[] {
  return ANATOMY_PARAM_KEYS.map(key => params[key]);
}

/** Whether `params` equals the cached values; allocation-free (per-frame path). */
function sameValues(values: readonly number[], params: AnatomyParams): boolean {
  for (let i = 0; i < ANATOMY_PARAM_KEYS.length; i++) {
    if (values[i] !== params[ANATOMY_PARAM_KEYS[i] as keyof AnatomyParams]) {
      return false;
    }
  }
  return true;
}

/**
 * Target world scale per joint (xyz interleaved) from the parameters, with its
 * two parts: the uniform propagated factor and the own-frame (non-uniform)
 * factor of the compensated parameters.
 */
function worldScales(
  plan: AnatomyPlan,
  params: AnatomyParams,
): {
  world: Float64Array;
  own: Float64Array;
  uniform: Float64Array;
  local: Float64Array;
} {
  const n = plan.names.length;
  const own = new Float64Array(n).fill(1);
  const local = new Float64Array(3 * n).fill(1);
  for (const key of ANATOMY_PARAM_KEYS) {
    const value = params[key];
    const mode = SCALE_MODES[key];
    for (const i of plan.joints[key]) {
      if (mode === 'uniform-subtree') {
        own[i] = (own[i] as number) * value;
        continue;
      }
      for (let a = 0; a < 3; a++) {
        const onLength = a === plan.lengthAxis;
        if (onLength === (mode === 'length-axis')) {
          local[3 * i + a] = (local[3 * i + a] as number) * value;
        }
      }
    }
  }
  // Propagating factors accumulate down the subtree; the others stay on their joint.
  const prop = new Float64Array(n);
  const world = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) {
    const p = plan.parent[i] as number;
    prop[i] = (p >= 0 ? (prop[p] as number) : 1) * (own[i] as number);
    for (let a = 0; a < 3; a++) {
      world[3 * i + a] = (prop[i] as number) * (local[3 * i + a] as number);
    }
  }
  return {world, own, uniform: prop, local};
}

function evaluate(binding: AnatomyBinding, params: AnatomyParams): Evaluation {
  const cached = CACHE.get(binding);
  if (cached !== undefined && sameValues(cached.values, params)) return cached;
  const values = valuesOf(params);
  const plan = planOf(binding);
  const {world, own, uniform, local} = worldScales(plan, params);
  const scales = new Map<string, Vector3>();
  const skinScales = new Map<string, Vector3>();
  const uniformScales = new Map<string, Vector3>();
  const poseList: Array<Evaluation['poseList'][number]> = [];
  const skins: Vector3[] = [];
  for (let i = 0; i < plan.names.length; i++) {
    const skin = new Vector3(
      local[3 * i] as number,
      local[3 * i + 1] as number,
      local[3 * i + 2] as number,
    );
    skins.push(skin);
    skinScales.set(plan.names[i] as string, skin);
    uniformScales.set(
      plan.names[i] as string,
      new Vector3().setScalar(uniform[i] as number),
    );
  }
  for (let i = 0; i < plan.names.length; i++) {
    const p = plan.parent[i] as number;
    const parentSkin = p >= 0 ? (skins[p] as Vector3) : null;
    poseList.push({
      name: plan.names[i] as string,
      boneScale: own[i] as number,
      skin: skins[i] as Vector3,
      parentSkin:
        parentSkin === null ||
        (parentSkin.x === 1 && parentSkin.y === 1 && parentSkin.z === 1)
          ? null
          : parentSkin,
    });
  }
  for (let i = 0; i < plan.names.length; i++) {
    const p = plan.parent[i] as number;
    const l = new Vector3();
    for (let a = 0; a < 3; a++) {
      const w = world[3 * i + a] as number;
      l.setComponent(a, p >= 0 ? w / (world[3 * p + a] as number) : w);
    }
    scales.set(plan.names[i] as string, l);
  }
  const next: Evaluation = {
    values,
    scales,
    world,
    uniform,
    poseList,
    skinScales,
    uniformScales,
    groundOffset: undefined,
  };
  CACHE.set(binding, next);
  return next;
}

/**
 * REQ-ANA-001..005: the anatomy scale of each joint relative to its parent,
 * keyed by exact joint name, for every joint of the character skeleton (1,1,1
 * where unaffected): the joint's target world scale (its own parameter factor,
 * plus the factors propagated from `height`, `head`, `hands` and `feet`
 * ancestors) divided by its parent's, per axis. Socketed props that inherit
 * scale use it (REQ-ANA-007). Length and cross-section axes come from
 * `rig.lengthAxis` (REQ-ANA-005).
 *
 * The pose does not write these into `Bone.scale` (see
 * {@link applyAnatomyToPose}): a diagonal local scale is inherited in the
 * parent's frame, which shears every child whose rest or animated rotation
 * differs from its parent's (the Quaternius foot is rotated 70° from the
 * calf, so chibi feet stretched 1.9× and knees sheared).
 *
 * Pure and deterministic (NFR-2). The result is cached per binding and
 * parameter values; treat it as read-only.
 */
export const applyAnatomy: ApplyAnatomy = (binding, params) =>
  evaluate(binding, params).scales;

/**
 * The own-frame scale that anatomy applies to the geometry skinned to each
 * joint (REQ-ANA-003, segment-scale compensation), keyed by exact joint name:
 * the factors of the compensated parameters (`torsoWidth`, `shoulders`,
 * `armLength`, `legLength`, `limbThickness`) on the joint's own length and
 * cross-section axes, (1,1,1) elsewhere. It scales the joint's skin (through
 * the inverse bind matrices, {@link applyAnatomyToSkins}) and its children's
 * joint offsets, and is never inherited by a child's frame, so a child keeps
 * its world scale and orientation at any rest or animated rotation.
 *
 * @param binding - Anatomy binding.
 * @param params - Anatomy values.
 * @returns Cached per binding and values; treat as read-only.
 */
export function anatomySkinScales(
  binding: AnatomyBinding,
  params: AnatomyParams,
): ReadonlyMap<string, Vector3> {
  return evaluate(binding, params).skinScales;
}

/**
 * The uniform anatomy world factor of each joint (REQ-ANA-007 as amended in
 * FX-CHIBI), keyed by exact joint name, as (u, u, u): the product of the
 * propagating factors (`height`, `head`, `hands`, `feet`) of the joint and its
 * ancestors. This is the scale a static prop on the joint's socket inherits
 * when `inheritScale` holds; the compensated factors never reach a prop.
 *
 * @param binding - Anatomy binding.
 * @param params - Anatomy values.
 * @returns Cached per binding and values; treat as read-only.
 */
export function anatomyUniformScales(
  binding: AnatomyBinding,
  params: AnatomyParams,
): AnatomyScales {
  return evaluate(binding, params).uniformScales;
}

/**
 * The character skeleton's rest pose as {@link applyAnatomyToPose} poses it:
 * each joint's rest translation scaled by its parent's own-frame skin factor
 * and its rest scale times its uniform (propagating) factor.
 */
function anatomyRest(binding: AnatomyBinding, e: Evaluation): RestPose {
  const rest = binding.body.rest;
  const plan = planOf(binding);
  const index = new Map(plan.names.map((n, i) => [n, i]));
  return {
    id: rest.id,
    joints: rest.joints.map(j => {
      const i = index.get(j.name);
      const entry = i === undefined ? undefined : e.poseList[i];
      if (entry === undefined) return j;
      const t = entry.parentSkin;
      const u = entry.boneScale;
      return {
        ...j,
        translation:
          t === null
            ? j.translation
            : ([
                j.translation[0] * t.x,
                j.translation[1] * t.y,
                j.translation[2] * t.z,
              ] as const),
        scale: [j.scale[0] * u, j.scale[1] * u, j.scale[2] * u] as const,
      };
    }),
  };
}

/** Values below this magnitude (metres) snap to 0 (REQ-ANA-008, AC-ANA-008.3). */
const GROUND_SNAP_M = 1e-9;

/** `x`, or 0 when its magnitude is below {@link GROUND_SNAP_M}. */
function snapGround(x: number): number {
  return Math.abs(x) < GROUND_SNAP_M ? 0 : x;
}

/**
 * The `soleOffsetM` of the character skeleton group (spec 002 REQ-ANA-008, REQ-ANA-021 rule f):
 * `rig.skeletonGroups[G].soleOffsetM`, 0 when the group or the field is absent.
 *
 * @param binding - Anatomy binding (its rig and the skeleton group of its body).
 * @returns Metres; positive moves the character up.
 */
export function soleOffsetOf(binding: AnatomyBinding): number {
  const id = binding.body.skeletonGroupId;
  return binding.rig.skeletonGroups.find(g => g.id === id)?.soleOffsetM ?? 0;
}

/**
 * Pipeline step 4 (REQ-ANA-008, amended M3-00): the vertical offset that puts the sole of the
 * feet at y = 0 in the bind pose,
 *
 * `groundOffsetY = −jointMinY(A) + soleOffsetM(G) × height × feet`,
 *
 * where `jointMinY(A)` is the lowest world Y among the `anatomyBones.feet` joints and their
 * descendants on the character skeleton's rest pose (`binding.body.rest`, never the body GLB)
 * with the anatomy scales applied, and `soleOffsetM(G)` is {@link soleOffsetOf} (0 when absent:
 * joint-only grounding, as in M1). The sole term scales with `height × feet`, the uniform world
 * scale of the feet joints. Joint-only: the inputs are the rig, the skeleton group and the
 * anatomy; no mesh vertex is ever read (AC-ANA-008.7). Values below 1e-9 m snap to 0, and
 * equal inputs give a bit-identical result (AC-ANA-008.3). Cached per binding and parameter
 * values.
 */
export const computeGroundOffset: ComputeGroundOffset = (binding, params) => {
  const e = evaluate(binding, params);
  if (e.groundOffset !== undefined) return e.groundOffset;
  const plan = planOf(binding);
  const world = restWorldMatrices(anatomyRest(binding, e));
  let lowest = Infinity;
  for (const i of plan.feet) {
    const m = world.get(plan.names[i] as string);
    if (m !== undefined && (m[13] as number) < lowest) lowest = m[13] as number;
  }
  // Rest sums leave ~1e-17 of float noise; snap it so default anatomy offsets by exactly 0.
  const joint = snapGround(Number.isFinite(lowest) ? 0 - lowest : 0);
  const sole = soleOffsetOf(binding);
  e.groundOffset =
    sole === 0 ? joint : snapGround(joint + sole * params.height * params.feet);
  return e.groundOffset;
};

/**
 * Resets every bone of the character skeleton to its rest TRS (the bind pose).
 * Call before sampling a clip, or before {@link applyAnatomyToPose} for the bind
 * pose.
 */
export function resetBodyToRest(binding: AnatomyBinding): void {
  for (const j of binding.body.rest.joints) {
    const bone = binding.body.bones.get(j.name);
    if (bone === undefined) continue;
    bone.position.set(j.translation[0], j.translation[1], j.translation[2]);
    bone.quaternion.set(
      j.rotation[0],
      j.rotation[1],
      j.rotation[2],
      j.rotation[3],
    );
    bone.scale.set(j.scale[0], j.scale[1], j.scale[2]);
  }
}

/**
 * World up (+Y) expressed in the rest-space of a joint's parent, with the
 * joint's rest translation component along it (REQ-ANA-010 clarification).
 */
interface UpAxis {
  /** Unit vector: world +Y in the parent's local frame at rest. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Rest value `v_rest` of the translation component along the axis. */
  readonly rest: number;
}

/** Up axes of the root and pelvis joints, cached per binding (no per-frame lookup). */
const UP_AXES = new WeakMap<
  AnatomyBinding,
  {readonly root: UpAxis; readonly pelvis: UpAxis}
>();

function upAxisOf(
  binding: AnatomyBinding,
  world: ReadonlyMap<string, ArrayLike<number>>,
  name: string,
): UpAxis {
  const joint = binding.body.rest.joints.find(j => j.name === name);
  if (joint === undefined) return {x: 0, y: 1, z: 0, rest: 0};
  const m = joint.parent === null ? undefined : world.get(joint.parent);
  let x = 0;
  let y = 1;
  let z = 0;
  if (m !== undefined) {
    // World up in the parent frame = row 1 of the parent's world rotation
    // (columns normalized to drop scale; column-major elements).
    const col = (c: number): number =>
      Math.hypot(
        m[4 * c] as number,
        m[4 * c + 1] as number,
        m[4 * c + 2] as number,
      ) || 1;
    x = (m[1] as number) / col(0);
    y = (m[5] as number) / col(1);
    z = (m[9] as number) / col(2);
    const n = Math.hypot(x, y, z) || 1;
    x /= n;
    y /= n;
    z /= n;
    // Snap float noise of axis-aligned rest rotations (e.g. -90° about X).
    if (Math.abs(x) < 1e-12) x = 0;
    if (Math.abs(y) < 1e-12) y = 0;
    if (Math.abs(z) < 1e-12) z = 0;
  }
  const t = joint.translation;
  return {x, y, z, rest: t[0] * x + t[1] * y + t[2] * z};
}

function upAxesOf(binding: AnatomyBinding): {
  readonly root: UpAxis;
  readonly pelvis: UpAxis;
} {
  let axes = UP_AXES.get(binding);
  if (axes === undefined) {
    const world = restWorldMatrices(binding.body.rest);
    axes = {
      root: upAxisOf(binding, world, binding.rig.rootBone),
      pelvis: upAxisOf(binding, world, binding.rig.socketBones.pelvis),
    };
    UP_AXES.set(binding, axes);
  }
  return axes;
}

/**
 * Applies anatomy to a sampled pose (pipeline step 3, REQ-ANA-009/010). Bones
 * must hold a freshly sampled (or reset) local pose; the call is not idempotent.
 *
 * - Rotation tracks are kept.
 * - Scale (REQ-ANA-009, segment-scale compensation): the sampled bone scale is
 *   multiplied by the joint's uniform propagating factor (`height`, `head`,
 *   `hands`, `feet`), which children inherit. The compensated factors
 *   ({@link anatomySkinScales}) never enter `Bone.scale`: they scale the
 *   joint's own geometry through {@link applyAnatomyToSkins}, so the effective
 *   scale of that geometry is the sampled scale times the anatomy scale.
 * - Translation: a child's local position is multiplied by its parent's
 *   own-frame factor (the joint follows the parent's changed length and
 *   cross-section); uniform factors reach it through the hierarchy.
 * - Root motion (REQ-ANA-010): "vertical" is the component of a joint's local
 *   translation along world up expressed in its parent's rest frame (local Y
 *   on the fixture rig, local Z for the pelvis under the Quaternius root that
 *   is rotated -90 degrees about X). The root's horizontal translation is
 *   multiplied by `legLength`; the vertical translation of the root and the
 *   pelvis (`rig.socketBones.pelvis`) is scaled by `legLength` as a delta from
 *   its rest value, so the bind-pose ground offset keeps the feet on the
 *   ground. The pelvis's horizontal components are kept.
 *
 * Allocation-free after the first call for a parameter set.
 */
export function applyAnatomyToPose(
  binding: AnatomyBinding,
  params: AnatomyParams,
): void {
  const {rig, body} = binding;
  const lf = params.legLength;
  const root = body.bones.get(rig.rootBone);
  const pelvis = body.bones.get(rig.socketBones.pelvis);
  const up = upAxesOf(binding);
  if (root !== undefined) {
    const u = up.root;
    const p = root.position;
    const v = p.x * u.x + p.y * u.y + p.z * u.z;
    const scaledV = u.rest + (v - u.rest) * lf;
    // Horizontal part (p - v·u) times legLength, plus the scaled vertical part.
    p.set(
      (p.x - v * u.x) * lf + scaledV * u.x,
      (p.y - v * u.y) * lf + scaledV * u.y,
      (p.z - v * u.z) * lf + scaledV * u.z,
    );
  }
  if (pelvis !== undefined && pelvis !== root) {
    const u = up.pelvis;
    const p = pelvis.position;
    const v = p.x * u.x + p.y * u.y + p.z * u.z;
    const delta = (v - u.rest) * (lf - 1);
    p.set(p.x + delta * u.x, p.y + delta * u.y, p.z + delta * u.z);
  }
  const list = evaluate(binding, params).poseList;
  for (let i = 0; i < list.length; i++) {
    const entry = list[i] as (typeof list)[number];
    const bone = body.bones.get(entry.name);
    if (bone === undefined) continue;
    if (entry.boneScale !== 1) bone.scale.multiplyScalar(entry.boneScale);
    if (entry.parentSkin !== null) bone.position.multiply(entry.parentSkin);
  }
}

/** Skin state of one skeleton bound to the character's bones. */
interface SkinState {
  /** The skeleton's own inverse bind matrices (shared, never written). */
  readonly original: readonly Matrix4[];
  /** Plan index of each skeleton bone, -1 for a bone outside the plan. */
  readonly joints: Int32Array;
  /** The evaluation last written into `skeleton.boneInverses`. */
  applied: Evaluation | null;
}

const SKINS = new WeakMap<Skeleton, SkinState>();
const SKIN_SCALE = new Matrix4();
let skinPlan: AnatomyPlan | null = null;
let skinEval: Evaluation | null = null;

function syncSkeleton(skeleton: Skeleton): void {
  const plan = skinPlan;
  const e = skinEval;
  if (plan === null || e === null) return;
  let state = SKINS.get(skeleton);
  if (state === undefined) {
    const original = skeleton.boneInverses.slice();
    // Own copies: a part's inverses may be shared with the registry's source mesh.
    for (let b = 0; b < original.length; b++) {
      skeleton.boneInverses[b] = (original[b] as Matrix4).clone();
    }
    const joints = new Int32Array(skeleton.bones.length);
    for (let b = 0; b < joints.length; b++) {
      joints[b] = plan.names.indexOf(skeleton.bones[b]?.name ?? '');
    }
    state = {original, joints, applied: null};
    SKINS.set(skeleton, state);
  }
  if (state.applied === e) return;
  for (let b = 0; b < state.joints.length; b++) {
    const inverse = skeleton.boneInverses[b];
    const original = state.original[b];
    if (inverse === undefined || original === undefined) continue;
    const j = state.joints[b] as number;
    const skin = j < 0 ? undefined : e.poseList[j]?.skin;
    if (skin === undefined || (skin.x === 1 && skin.y === 1 && skin.z === 1)) {
      inverse.copy(original);
    } else {
      inverse.multiplyMatrices(
        SKIN_SCALE.makeScale(skin.x, skin.y, skin.z),
        original,
      );
    }
  }
  state.applied = e;
}

function visitSkin(object: Object3D): void {
  const mesh = object as Partial<SkinnedMesh>;
  if (mesh.isSkinnedMesh === true && mesh.skeleton !== undefined) {
    syncSkeleton(mesh.skeleton);
  }
}

/**
 * Pipeline step 3, skin part (REQ-ANA-003, segment-scale compensation): for
 * every skinned mesh under `root`, sets each inverse bind matrix to
 * `S(skin) · B⁻¹`, where `S(skin)` is the joint's own-frame factor
 * ({@link anatomySkinScales}) and `B⁻¹` the mesh's own inverse bind matrix,
 * so skinning (GPU, and CPU bounds through `boneInverses`) scales each joint's
 * geometry in its own frame without the scale reaching its children. A
 * skeleton is rewritten only when the anatomy values changed since its last
 * call; (1,1,1) restores the original matrix exactly (default anatomy is
 * bit-identical to no anatomy). Allocation-free after the first call per
 * skeleton.
 *
 * @param binding - Anatomy binding.
 * @param params - Anatomy values.
 * @param root - The character root holding the attached skinned parts.
 */
export function applyAnatomyToSkins(
  binding: AnatomyBinding,
  params: AnatomyParams,
  root: Object3D,
): void {
  skinPlan = planOf(binding);
  skinEval = evaluate(binding, params);
  try {
    root.traverse(visitSkin);
  } finally {
    skinPlan = null;
    skinEval = null;
  }
}

const SCRATCH = new Vector3();

/** Sockets whose props inherit the joint's scale by default (REQ-ANA-007). */
export function defaultInheritScale(socket: SocketId): boolean {
  return socket === 'head';
}

/**
 * Scale (and offset scale) that keeps a static prop's world scale and authored
 * offset unchanged under anatomy (REQ-ANA-007). A prop parented to the socket
 * joint inherits the joint frame's world scale, which is the uniform product
 * of the propagating factors (`height`, `head`, `hands`, `feet`) of the joint
 * and its ancestors (the compensated factors only skin the joint's own
 * geometry, {@link anatomySkinScales}); this returns the factor to apply to
 * the prop's local scale and local offset: `1/s` of that scale when
 * `inheritScale` is false, else (1,1,1) so the joint's scale (and the
 * scaled offset) is kept. `inheritScale` defaults to {@link defaultInheritScale}.
 *
 * The returned vector is reused between calls; copy it before the next call.
 */
export function socketPropScale(
  binding: AnatomyBinding,
  params: AnatomyParams,
  socket: SocketId,
  inheritScale: boolean = defaultInheritScale(socket),
): Vector3 {
  if (inheritScale) return SCRATCH.set(1, 1, 1);
  const plan = planOf(binding);
  const i = plan.names.indexOf(binding.rig.socketBones[socket]);
  if (i < 0) return SCRATCH.set(1, 1, 1);
  // The joint's frame carries only the uniform (propagated) scale; its own
  // compensated factor skins its geometry and never reaches a child object.
  const u = evaluate(binding, params).uniform[i] as number;
  return SCRATCH.set(1 / u, 1 / u, 1 / u);
}
