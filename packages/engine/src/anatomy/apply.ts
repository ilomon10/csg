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
  readonly values: number[];
  readonly scales: Map<string, Vector3>;
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

function sameValues(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
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
  const values = valuesOf(params);
  const cached = CACHE.get(binding);
  if (cached !== undefined && sameValues(cached.values, values)) return cached;
  const plan = planOf(binding);
  const world = worldScales(plan, params);
  const scales = new Map<string, Vector3>();
  const tuples = new Map<string, Vec3>();
  for (let i = 0; i < plan.names.length; i++) {
    const p = plan.parent[i] as number;
    const l = new Vector3();
    for (let a = 0; a < 3; a++) {
      const w = world[3 * i + a] as number;
      l.setComponent(a, p >= 0 ? w / (world[3 * p + a] as number) : w);
    }
    scales.set(plan.names[i] as string, l);
    tuples.set(plan.names[i] as string, [l.x, l.y, l.z]);
  }
  const next: Evaluation = {
    values,
    scales,
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

/** Rest heights of the root and pelvis joints, cached per binding (no per-frame lookup). */
const REST_HEIGHTS = new WeakMap<
  AnatomyBinding,
  {readonly root: number; readonly pelvis: number}
>();

function restHeightsOf(binding: AnatomyBinding): {
  readonly root: number;
  readonly pelvis: number;
} {
  let heights = REST_HEIGHTS.get(binding);
  if (heights === undefined) {
    const {rig, body} = binding;
    const y = (name: string): number =>
      body.rest.joints.find(j => j.name === name)?.translation[1] ?? 0;
    heights = {root: y(rig.rootBone), pelvis: y(rig.socketBones.pelvis)};
    REST_HEIGHTS.set(binding, heights);
  }
  return heights;
}

/**
 * Applies anatomy to a sampled pose (pipeline step 3, REQ-ANA-009/010). Bones
 * must hold a freshly sampled (or reset) local pose; the call is not idempotent.
 *
 * - Rotation tracks are kept.
 * - Scale: the sampled scale is multiplied by the anatomy scale (REQ-ANA-009).
 * - Non-root translation needs no change: a child's local position is scaled
 *   by its parent's world scale through the hierarchy (REQ-ANA-009).
 * - Root motion: the root joint's horizontal translation is multiplied by
 *   `legLength`, and the vertical translation of the root and the pelvis
 *   (`rig.socketBones.pelvis`) is scaled by `legLength` as a delta from the rest
 *   height, so the bind-pose ground offset keeps the feet on the ground
 *   (REQ-ANA-010).
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
  const restY = restHeightsOf(binding);
  if (root !== undefined) {
    const r = restY.root;
    root.position.x *= lf;
    root.position.z *= lf;
    root.position.y = r + (root.position.y - r) * lf;
  }
  if (pelvis !== undefined && pelvis !== root) {
    const r = restY.pelvis;
    pelvis.position.y = r + (pelvis.position.y - r) * lf;
  }
  for (const [name, scale] of evaluate(binding, params).scales) {
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
