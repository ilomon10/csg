import {Vector3} from 'three';
import {ANATOMY_PARAM_KEYS} from '@csg/parts-schema';
import type {AnatomyParams, SocketId} from '@csg/parts-schema';
import type {
  AnatomyBinding,
  ApplyAnatomy,
  ComputeGroundOffset,
} from '../contracts/anatomy';
import type {Vec3} from '../retarget';
import {restWorldMatrices} from '../rig';
import type {AnatomyPlan} from './plan';
import {SCALE_MODES, planOf} from './plan';

/** Result of one evaluation, cached per binding until the parameters change. */
interface Evaluation {
  /** Parameter values in `ANATOMY_PARAM_KEYS` order (the cache key). */
  readonly values: number[];
  readonly scales: Map<string, Vector3>;
  /**
   * The same scales as a flat list, iterated by index in the per-frame path
   * (a `Map` iterator allocates its entries; REQ-ANM-008).
   */
  readonly scaleList: ReadonlyArray<{
    readonly name: string;
    readonly scale: Vector3;
  }>;
  /** The same scales as tuples, the input of rig forward kinematics. */
  readonly tuples: Map<string, Vec3>;
  /** Target world scale per joint, xyz interleaved (see {@link applyAnatomy}). */
  readonly world: Float64Array;
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

/** Target world scale per joint (xyz interleaved) from the parameters. */
function worldScales(plan: AnatomyPlan, params: AnatomyParams): Float64Array {
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
  return world;
}

function evaluate(binding: AnatomyBinding, params: AnatomyParams): Evaluation {
  const cached = CACHE.get(binding);
  if (cached !== undefined && sameValues(cached.values, params)) return cached;
  const values = valuesOf(params);
  const plan = planOf(binding);
  const world = worldScales(plan, params);
  const scales = new Map<string, Vector3>();
  const tuples = new Map<string, Vec3>();
  const scaleList: Array<{name: string; scale: Vector3}> = [];
  for (let i = 0; i < plan.names.length; i++) {
    const p = plan.parent[i] as number;
    const l = new Vector3();
    for (let a = 0; a < 3; a++) {
      const w = world[3 * i + a] as number;
      l.setComponent(a, p >= 0 ? w / (world[3 * p + a] as number) : w);
    }
    scales.set(plan.names[i] as string, l);
    scaleList.push({name: plan.names[i] as string, scale: l});
    tuples.set(plan.names[i] as string, [l.x, l.y, l.z]);
  }
  const next: Evaluation = {
    values,
    scales,
    scaleList,
    tuples,
    world,
    groundOffset: undefined,
  };
  CACHE.set(binding, next);
  return next;
}

/**
 * Pipeline step 3 (REQ-ANA-001..005): local scale per joint, keyed by exact
 * joint name, for every joint of the character skeleton (1,1,1 where
 * unaffected). The scales implement segment-scale compensation: every joint
 * has a target world scale (its own parameter factor, plus the factors
 * propagated from `height`, `head`, `hands` and `feet` ancestors), and its
 * local scale is that target divided by its parent's, so a child never inherits
 * a parent's compensated scale while its joint position still follows the
 * parent's changed length. Length and cross-section axes come from
 * `rig.lengthAxis` (REQ-ANA-005). Compensation is exact where the child's rest
 * rotation keeps the axes aligned (identity); a small rest rotation leaves a
 * small residual shear because `Bone.scale` is diagonal.
 *
 * Pure and deterministic (NFR-2). The result is cached per binding and
 * parameter values; treat it as read-only.
 */
export const applyAnatomy: ApplyAnatomy = (binding, params) =>
  evaluate(binding, params).scales;

/**
 * Pipeline step 4 (REQ-ANA-008): vertical offset that puts the lowest feet
 * joint (feet joints and their descendants) at y = 0 in the bind pose of the
 * character skeleton's rest pose (`binding.body.rest`, never the body GLB),
 * with the anatomy scales applied. Cached per binding and parameter values.
 */
export const computeGroundOffset: ComputeGroundOffset = (binding, params) => {
  const e = evaluate(binding, params);
  if (e.groundOffset !== undefined) return e.groundOffset;
  const plan = planOf(binding);
  const world = restWorldMatrices(binding.body.rest, e.tuples);
  let lowest = Infinity;
  for (const i of plan.feet) {
    const m = world.get(plan.names[i] as string);
    if (m !== undefined && (m[13] as number) < lowest) lowest = m[13] as number;
  }
  // Rest sums leave ~1e-17 of float noise; snap it so default anatomy offsets by exactly 0.
  const offset = Number.isFinite(lowest) ? 0 - lowest : 0;
  e.groundOffset = Math.abs(offset) < 1e-9 ? 0 : offset;
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
 * - Scale: the sampled scale is multiplied by the anatomy scale (REQ-ANA-009).
 * - Non-root translation needs no change: a child's local position is scaled
 *   by its parent's world scale through the hierarchy (REQ-ANA-009).
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
  const list = evaluate(binding, params).scaleList;
  for (let i = 0; i < list.length; i++) {
    const {name, scale} = list[i] as (typeof list)[number];
    body.bones.get(name)?.scale.multiply(scale);
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
 * joint inherits that joint's world scale; this returns the factor to apply to
 * the prop's local scale and local offset: `1/s` of the joint's target world
 * scale when `inheritScale` is false, else (1,1,1) so the joint's scale (and the
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
  const w = evaluate(binding, params).world;
  return SCRATCH.set(
    1 / (w[3 * i] as number),
    1 / (w[3 * i + 1] as number),
    1 / (w[3 * i + 2] as number),
  );
}
