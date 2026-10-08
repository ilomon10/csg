/** Leg length over rig forward kinematics (REQ-ANM-023, m1-plan section 2.6). */
import {restWorldPositions} from '../rig';
import type {RestPose} from './types';

// Re-exported for existing importers; the FK itself lives in `../rig`.
export {restWorldPositions};

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
