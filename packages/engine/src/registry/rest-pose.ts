/**
 * Rest poses and the character skeleton group (spec 001 REQ-CMP-037, spec 002 REQ-ANA-021,
 * spec 011 REQ-AST-026).
 */
import type {RigDefinition} from '@csg/parts-schema';
import type {JointRestTRS, RestPose} from '../retarget/types';
import type {CharacterSkeletonGroupOf, RestPoseOf} from '../contracts/registry';

const CACHE = new WeakMap<RigDefinition, Map<string, RestPose>>();

/**
 * Converts `rig.skeletonGroups[id].restPose` into the retarget {@link RestPose}: joints in
 * `rig.bones` order (parents first) with `rig.parents`. Pure and cached per rig object and
 * group. An unknown group, or a group without a transform for some bone, yields
 * `AST_RIG_MISMATCH` (`details.skeletonGroup`, `details.missing`).
 */
export const restPoseOf: RestPoseOf = (rig, groupId) => {
  let perRig = CACHE.get(rig);
  const cached = perRig?.get(groupId);
  if (cached !== undefined) return {ok: true, value: cached};
  const group = rig.skeletonGroups.find(g => g.id === groupId);
  if (group === undefined) {
    return {
      ok: false,
      error: {
        code: 'AST_RIG_MISMATCH',
        message: `rig "${rig.id}" has no skeleton group "${groupId}"`,
        details: {skeletonGroup: groupId, missing: []},
      },
    };
  }
  const joints: JointRestTRS[] = [];
  const missing: string[] = [];
  for (const name of rig.bones) {
    const rest = group.restPose[name];
    if (rest === undefined) {
      missing.push(name);
      continue;
    }
    joints.push({
      name,
      parent: rig.parents[name] ?? null,
      translation: [rest.t[0], rest.t[1], rest.t[2]],
      rotation: [rest.r[0], rest.r[1], rest.r[2], rest.r[3]],
      scale: [rest.s[0], rest.s[1], rest.s[2]],
    });
  }
  if (missing.length > 0) {
    return {
      ok: false,
      error: {
        code: 'AST_RIG_MISMATCH',
        message: `skeleton group "${groupId}" of rig "${rig.id}" lacks bones: ${missing.join(', ')}`,
        details: {skeletonGroup: groupId, missing: [...missing].sort()},
      },
    };
  }
  const pose: RestPose = {id: groupId, joints};
  if (perRig === undefined) {
    perRig = new Map();
    CACHE.set(rig, perRig);
  }
  perRig.set(groupId, pose);
  return {ok: true, value: pose};
};

/**
 * The skeleton group that builds a character (REQ-CMP-037): the body's
 * `characterSkeletonGroup`, else its `skeletonGroup`, else `rig.defaultSkeletonGroup`.
 */
export const characterSkeletonGroupOf: CharacterSkeletonGroupOf = (body, rig) =>
  body.characterSkeletonGroup ?? body.skeletonGroup ?? rig.defaultSkeletonGroup;
