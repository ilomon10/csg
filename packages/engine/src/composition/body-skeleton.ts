/**
 * Character skeleton built from rig rest data (spec 001 REQ-CMP-037, spec 011
 * REQ-AST-026). The body GLB does not provide the skeleton: it is attached like
 * any other skinned part (see `attach-skinned-part.ts`).
 */
import {Bone, Group, Skeleton} from 'three';
import type {RigDefinition, SkeletonGroupId} from '@csg/parts-schema';
import type {BodySkeleton, CreateBodySkeleton} from '../contracts/composition';
import type {EngineError, Result} from '../contracts/errors';
import type {JointRestTRS, RestPose} from '../retarget/types';

/** Name of the {@link BodySkeleton.root} container object. */
export const BODY_SKELETON_ROOT_NAME = 'character-skeleton';

function mismatch(
  message: string,
  missing: readonly string[],
  extra: Readonly<Record<string, unknown>> = {},
): Result<never, EngineError> {
  return {
    ok: false,
    error: {
      code: 'AST_RIG_MISMATCH',
      message,
      details: {missing: [...new Set(missing)].sort(), ...extra},
    },
  };
}

/**
 * Converts `rig.skeletonGroups[groupId].restPose` into a {@link RestPose} in
 * `rig.bones` order. Kept local so composition does not depend on the registry
 * implementation; equal in content to the registry's `restPoseOf`.
 */
function restPoseOfGroup(
  rig: RigDefinition,
  groupId: SkeletonGroupId,
): Result<RestPose, EngineError> {
  const group = rig.skeletonGroups.find(g => g.id === groupId);
  if (group === undefined) {
    return mismatch(`rig "${rig.id}" has no skeleton group "${groupId}"`, [], {
      skeletonGroup: groupId,
    });
  }
  const joints: JointRestTRS[] = [];
  const missing: string[] = [];
  for (const name of rig.bones) {
    const t = group.restPose[name];
    if (t === undefined) {
      missing.push(name);
      continue;
    }
    joints.push({
      name,
      parent: rig.parents[name] ?? null,
      translation: [t.t[0], t.t[1], t.t[2]],
      rotation: [t.r[0], t.r[1], t.r[2], t.r[3]],
      scale: [t.s[0], t.s[1], t.s[2]],
    });
  }
  if (missing.length > 0) {
    return mismatch(
      `skeleton group "${groupId}" of rig "${rig.id}" lacks bones`,
      missing,
      {skeletonGroup: groupId},
    );
  }
  return {ok: true, value: {id: groupId, joints}};
}

/**
 * Builds the character skeleton (REQ-CMP-037): one `Bone` per `rig.bones`
 * entry, in that order, parented by `rig.parents`, with the local rest TRS of
 * the given rest pose. `skeleton.boneInverses` are computed from those rest
 * world matrices. All bones live under {@link BodySkeleton.root}, a `Group` at
 * the identity transform.
 *
 * @param rig - Rig definition (validated by `rigDefinitionSchema`).
 * @param rest - Rest pose of one skeleton group, or the group id, which is
 *   resolved from `rig.skeletonGroups`.
 * @returns The skeleton, or `AST_RIG_MISMATCH` when the rest pose does not
 *   cover every rig bone with the rig's parents (`details.missing` lists the
 *   uncovered bones, sorted) or the group is unknown.
 */
export const createBodySkeleton: (
  rig: RigDefinition,
  rest: RestPose | SkeletonGroupId,
) => Result<BodySkeleton, EngineError> = (rig, restOrId) => {
  let rest: RestPose;
  if (typeof restOrId === 'string') {
    const resolved = restPoseOfGroup(rig, restOrId);
    if (!resolved.ok) return resolved;
    rest = resolved.value;
  } else {
    rest = restOrId;
  }

  const byName = new Map<string, JointRestTRS>();
  for (const joint of rest.joints) byName.set(joint.name, joint);
  const missing = rig.bones.filter(name => !byName.has(name));
  if (missing.length > 0) {
    return mismatch(
      `rest pose "${rest.id}" lacks bones of rig "${rig.id}"`,
      missing,
      {skeletonGroup: rest.id},
    );
  }
  const wrongParent = rig.bones.filter(
    name => (byName.get(name)?.parent ?? null) !== (rig.parents[name] ?? null),
  );
  if (wrongParent.length > 0) {
    return mismatch(
      `rest pose "${rest.id}" has parents that differ from rig "${rig.id}"`,
      [],
      {skeletonGroup: rest.id, parents: wrongParent},
    );
  }

  const root = new Group();
  root.name = BODY_SKELETON_ROOT_NAME;
  const bones = new Map<string, Bone>();
  const ordered: Bone[] = [];
  for (const name of rig.bones) {
    const joint = byName.get(name);
    if (joint === undefined) continue; // checked above
    const bone = new Bone();
    bone.name = name;
    bone.position.fromArray(joint.translation);
    bone.quaternion.fromArray(joint.rotation);
    bone.scale.fromArray(joint.scale);
    const parentName = rig.parents[name] ?? null;
    const parent = parentName === null ? root : bones.get(parentName);
    if (parent === undefined) {
      // The schema guarantees parents precede children; guard anyway.
      return mismatch(
        `bone "${name}" precedes its parent "${String(parentName)}"`,
        [],
        {parents: [name]},
      );
    }
    parent.add(bone);
    bones.set(name, bone);
    ordered.push(bone);
  }
  root.updateMatrixWorld(true);
  // Skeleton computes boneInverses from the current (rest) world matrices.
  const skeleton = new Skeleton(ordered);

  return {
    ok: true,
    value: {rig, skeletonGroupId: rest.id, rest, root, bones, skeleton},
  };
};

/** Compile-time check that the implementation satisfies the M1 contract. */
const CONTRACT_CHECK: CreateBodySkeleton = createBodySkeleton;
void CONTRACT_CHECK;
