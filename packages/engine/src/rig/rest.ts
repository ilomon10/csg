import type {JointRestTRS, RestPose} from '../retarget/types';

/** Local rest transform of one joint, the shape of `RestTransform` in `@csg/parts-schema`. */
export interface RigRestTransform {
  readonly t: readonly [number, number, number];
  readonly r: readonly [number, number, number, number];
  readonly s: readonly [number, number, number];
}

/**
 * The part of a `RigDefinition` the rig helpers read. Structural, so this
 * module needs no import of `@csg/parts-schema`.
 */
export interface RigRestSource {
  readonly bones: readonly string[];
  readonly parents: Readonly<Record<string, string | null>>;
  readonly skeletonGroups: readonly {
    readonly id: string;
    readonly restPose: Readonly<Record<string, RigRestTransform>>;
  }[];
}

/**
 * Rest pose of one skeleton group, joints in `rig.bones` order (REQ-ANA-021).
 *
 * @param rig - Rig data.
 * @param groupId - Skeleton group id.
 * @returns The rest pose, or `undefined` when the group is unknown or lacks a
 *   transform for some joint.
 */
export function restPoseForGroup(
  rig: RigRestSource,
  groupId: string,
): RestPose | undefined {
  const group = rig.skeletonGroups.find(g => g.id === groupId);
  if (group === undefined) return undefined;
  const joints: JointRestTRS[] = [];
  for (const name of rig.bones) {
    const rest = group.restPose[name];
    if (rest === undefined) return undefined;
    joints.push({
      name,
      parent: rig.parents[name] ?? null,
      translation: [rest.t[0], rest.t[1], rest.t[2]],
      rotation: [rest.r[0], rest.r[1], rest.r[2], rest.r[3]],
      scale: [rest.s[0], rest.s[1], rest.s[2]],
    });
  }
  return {id: groupId, joints};
}

/**
 * Problems of a rest pose's hierarchy, as readable strings (empty when valid):
 * duplicate joints, a parent that is unknown or does not precede its child,
 * and a root count other than one (REQ-ANA-021 b, c).
 *
 * @param rest - Rest pose to check.
 * @returns Problem descriptions in joint order.
 */
export function checkParentOrder(rest: RestPose): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  let roots = 0;
  for (const j of rest.joints) {
    if (seen.has(j.name)) problems.push(`duplicate joint "${j.name}"`);
    if (j.parent === null) {
      roots++;
    } else if (!seen.has(j.parent)) {
      problems.push(
        `joint "${j.name}" has parent "${j.parent}" that is missing or does not precede it`,
      );
    }
    seen.add(j.name);
  }
  if (roots !== 1) problems.push(`expected exactly one root, found ${roots}`);
  return problems;
}

/**
 * Joints of the subtree rooted at each of `roots`, roots included, in rest
 * joint order (parents first).
 *
 * @param rest - Rest pose.
 * @param roots - Subtree root joint names.
 * @returns Joint names of all subtrees, without duplicates.
 */
export function subtreeJoints(
  rest: RestPose,
  roots: readonly string[],
): string[] {
  const inside = new Set<string>(roots);
  const out: string[] = [];
  for (const j of rest.joints) {
    if (inside.has(j.name) || (j.parent !== null && inside.has(j.parent))) {
      inside.add(j.name);
      out.push(j.name);
    }
  }
  return out;
}
