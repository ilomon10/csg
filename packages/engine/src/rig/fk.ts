import type {RestPose, Vec3} from '../retarget/types';
import {mat4Compose, mat4Multiply} from './mat4';
import type {Mat4} from './mat4';
import {quatNormalize} from './quat';

/**
 * World matrices of every joint by forward kinematics over the local rest TRS
 * (REQ-ANA-003, REQ-ANA-008, REQ-ANM-023). Full 4x4 matrices, so rotated and
 * non-uniformly scaled ancestors are exact. This is the single FK source for
 * anatomy, retarget and the Node tools. Joints must be ordered
 * parent-before-child.
 *
 * @param rest - Rest pose of one skeleton group.
 * @param localScales - Optional per-joint factors multiplied into the local
 *   rest scale (anatomy scales, keyed by exact joint name).
 * @param rootWorld - Optional matrix applied above root joints (glTF armature
 *   node); identity by default.
 * @returns Joint name to column-major world matrix, in joint order.
 * @throws Error when a joint names a parent that does not precede it.
 */
export function restWorldMatrices(
  rest: RestPose,
  localScales?: ReadonlyMap<string, Vec3>,
  rootWorld?: ArrayLike<number>,
): ReadonlyMap<string, Mat4> {
  const world = new Map<string, Mat4>();
  for (const j of rest.joints) {
    const f = localScales?.get(j.name);
    const s: Vec3 = f
      ? [j.scale[0] * f[0], j.scale[1] * f[1], j.scale[2] * f[2]]
      : j.scale;
    const local = mat4Compose(j.translation, quatNormalize(j.rotation), s);
    if (j.parent === null) {
      world.set(j.name, rootWorld ? mat4Multiply(rootWorld, local) : local);
      continue;
    }
    const p = world.get(j.parent);
    if (!p) {
      throw new Error(
        `restWorldMatrices: joint "${j.name}" of "${rest.id}" has parent "${j.parent}" that does not precede it`,
      );
    }
    world.set(j.name, mat4Multiply(p, local));
  }
  return world;
}

/**
 * World-space rest positions of every joint (the translation column of
 * {@link restWorldMatrices}).
 *
 * @param rest - Rest pose of one skeleton group, joints parent-before-child.
 * @returns Joint name to world position, in joint order.
 * @throws Error when a joint names a parent that does not precede it.
 */
export function restWorldPositions(rest: RestPose): ReadonlyMap<string, Vec3> {
  const out = new Map<string, Vec3>();
  for (const [name, m] of restWorldMatrices(rest)) {
    out.set(name, [m[12] ?? 0, m[13] ?? 0, m[14] ?? 0]);
  }
  return out;
}
