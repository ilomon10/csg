/** Forward kinematics over rest TRS (REQ-ANM-023, m1-plan section 2.6). */
import {quatMultiply, quatNormalize, quatRotateVec3} from './quat';
import type {Quat, RestPose, Vec3} from './types';

interface WorldTRS {
  readonly t: Vec3;
  readonly r: Quat;
  readonly s: Vec3;
}

/**
 * World-space rest positions of every joint by forward kinematics over the
 * local rest TRS. Joints must be ordered parent-before-child.
 *
 * @param rest - Rest pose.
 * @returns Joint name to world position, in joint order.
 * @throws Error when a joint names a parent that does not precede it.
 */
export function restWorldPositions(rest: RestPose): ReadonlyMap<string, Vec3> {
  const world = new Map<string, WorldTRS>();
  const out = new Map<string, Vec3>();
  for (const j of rest.joints) {
    const r = quatNormalize(j.rotation);
    let w: WorldTRS;
    if (j.parent === null) {
      w = {t: j.translation, r, s: j.scale};
    } else {
      const p = world.get(j.parent);
      if (!p) {
        throw new Error(
          `restWorldPositions: joint "${j.name}" of "${rest.id}" has parent "${j.parent}" that does not precede it`,
        );
      }
      const scaled: Vec3 = [
        p.s[0] * j.translation[0],
        p.s[1] * j.translation[1],
        p.s[2] * j.translation[2],
      ];
      const off = quatRotateVec3(p.r, scaled);
      w = {
        t: [p.t[0] + off[0], p.t[1] + off[1], p.t[2] + off[2]],
        r: quatNormalize(quatMultiply(p.r, r)),
        s: [p.s[0] * j.scale[0], p.s[1] * j.scale[1], p.s[2] * j.scale[2]],
      };
    }
    world.set(j.name, w);
    out.set(j.name, w.t);
  }
  return out;
}

/**
 * Leg length `L` of a rest pose (REQ-ANM-023): the rest-pose world height
 * (glTF +Y) of the hip (pelvis) joint above the lowest joint listed in
 * `footBones`.
 *
 * @param rest - Rest pose of one skeleton group.
 * @param hipBone - Hip (pelvis) bone name.
 * @param footBones - Foot bone names (at least one).
 * @returns `world(hip).y − min(world(foot).y)`.
 * @throws Error when a bone is missing or `footBones` is empty (validate first).
 */
export function legLength(
  rest: RestPose,
  hipBone: string,
  footBones: readonly string[],
): number {
  if (footBones.length === 0) throw new Error('legLength: no foot bones');
  const world = restWorldPositions(rest);
  const hip = world.get(hipBone);
  if (!hip) throw new Error(`legLength: hip bone "${hipBone}" missing`);
  let lowest = Infinity;
  for (const f of footBones) {
    const p = world.get(f);
    if (!p) throw new Error(`legLength: foot bone "${f}" missing`);
    if (p[1] < lowest) lowest = p[1];
  }
  return hip[1] - lowest;
}
