import {z} from 'zod';
import {
  ANATOMY_PARAM_KEYS,
  BODY_REGIONS,
  SOCKET_IDS,
  anatomyParamKeySchema,
  bodyRegionSchema,
  socketIdSchema,
} from './body';
import {rigIdSchema, skeletonGroupIdSchema} from './primitives';

/** Joint name as it appears in the source skeleton, e.g. `Head` (decision D1: not renamed). */
export const jointNameSchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/, {
  error: issue => `invalid joint name ${JSON.stringify(issue.input)}`,
});

/** Inferred type of {@link jointNameSchema}. */
export type JointName = z.infer<typeof jointNameSchema>;

const finite = z.number().finite();

/** Local rest transform of one joint: translation, rotation quaternion `xyzw`, scale. */
export const restTransformSchema = z.object({
  t: z.tuple([finite, finite, finite]),
  r: z.tuple([finite, finite, finite, finite]),
  s: z.tuple([finite, finite, finite]),
});

/** Inferred type of {@link restTransformSchema}. */
export type RestTransform = z.infer<typeof restTransformSchema>;

/** Rest pose of one skeleton group (spec 011 REQ-AST-026): a transform for every bone. */
export const skeletonGroupSchema = z.object({
  id: skeletonGroupIdSchema,
  restPose: z.record(jointNameSchema, restTransformSchema),
  /**
   * Metres from the lowest foot joint to the sole of the group's feet (spec 002 REQ-ANA-008,
   * spec 011 REQ-AST-030). Finite, -0.1..0.1, a whole multiple of 0.0001; absent means 0.
   * Written by `assets:verify-rig --write-canonical` (REQ-AST-034), never by hand.
   */
  soleOffsetM: z
    .number()
    .finite()
    .min(-0.1)
    .max(0.1)
    .refine(
      value => Math.abs(value * 10000 - Math.round(value * 10000)) < 1e-6,
      {
        error: 'must be a whole multiple of 0.0001',
      },
    )
    .optional(),
});

/** Inferred type of {@link skeletonGroupSchema}. */
export type SkeletonGroup = z.infer<typeof skeletonGroupSchema>;

const jointList = z.array(jointNameSchema);

/**
 * Canonical rig (specs 002 and 011, architecture 3.2), stored in
 * `packages/parts-schema/rigs/<rigId>.json`. Unknown fields round-trip (loose object).
 */
export const rigDefinitionSchema = z
  .looseObject({
    id: rigIdSchema,
    /** Free-form note kept with the hand-edited overlay. */
    comment: z.string().optional(),
    /** Joint names in hierarchy order (parents before children). */
    bones: z.array(jointNameSchema).min(1),
    /** Joint used as the root for yaw and translation snapping. */
    rootBone: jointNameSchema,
    /** Local axis along which each bone's length runs. */
    lengthAxis: z.enum(['x', 'y', 'z']),
    /** Anatomy control to joints; all nine controls required, none empty (AC-ANA-002.2). */
    anatomyBones: z.record(anatomyParamKeySchema, jointList),
    /** Body region to joints, used for hides and `_REGION`; all 11 regions required. */
    regionBones: z.record(bodyRegionSchema, jointList),
    /** Socket ID to the joint that carries it (decision D1); `pelvis` is the hip. */
    socketBones: z.record(socketIdSchema, jointNameSchema),
    skeletonHeightM: z.number().positive().optional(),
    /** Bone to parent bone; exactly one `null` (the root bone). */
    parents: z.record(jointNameSchema, jointNameSchema.nullable()),
    /** Rest poses of the skeleton groups (spec 011 REQ-AST-026); IDs are unique. */
    skeletonGroups: z.array(skeletonGroupSchema).min(1),
    /** Group used as the reference; one of `skeletonGroups[].id`. */
    defaultSkeletonGroup: skeletonGroupIdSchema,
  })
  .superRefine((rig, ctx) => {
    const fail = (path: Array<string | number>, message: string) =>
      ctx.addIssue({code: 'custom', path, message});
    const index = new Map<string, number>();
    rig.bones.forEach((bone, i) => {
      if (index.has(bone)) fail(['bones', i], `duplicate bone "${bone}"`);
      index.set(bone, i);
    });
    const known = (bone: string) => index.has(bone);
    if (!known(rig.rootBone))
      fail(['rootBone'], `rootBone "${rig.rootBone}" is not in bones`);

    for (const key of ANATOMY_PARAM_KEYS) {
      const list = rig.anatomyBones[key];
      if (list.length === 0)
        fail(['anatomyBones', key], `anatomy key "${key}" has no bones`);
      list.forEach((bone, i) => {
        if (!known(bone))
          fail(['anatomyBones', key, i], `unknown bone "${bone}"`);
      });
    }
    const owner = new Map<string, string>();
    for (const region of BODY_REGIONS) {
      rig.regionBones[region].forEach((bone, i) => {
        if (!known(bone))
          fail(['regionBones', region, i], `unknown bone "${bone}"`);
        const previous = owner.get(bone);
        if (previous !== undefined) {
          fail(
            ['regionBones', region, i],
            `bone "${bone}" is in regions "${previous}" and "${region}"`,
          );
        }
        owner.set(bone, region);
      });
    }
    for (const socket of SOCKET_IDS) {
      const bone = rig.socketBones[socket];
      if (!known(bone)) fail(['socketBones', socket], `unknown bone "${bone}"`);
    }

    for (const bone of Object.keys(rig.parents)) {
      if (!known(bone)) fail(['parents', bone], `unknown bone "${bone}"`);
    }
    rig.bones.forEach((bone, i) => {
      const parent = rig.parents[bone];
      if (parent === undefined) {
        fail(['parents', bone], `bone "${bone}" has no parents entry`);
      } else if (parent === null) {
        if (bone !== rig.rootBone) {
          fail(
            ['parents', bone],
            `exactly one root is required: only rootBone "${rig.rootBone}" may have a null parent`,
          );
        }
      } else {
        const parentIndex = index.get(parent);
        if (parentIndex === undefined) {
          fail(['parents', bone], `unknown parent "${parent}"`);
        } else if (parentIndex >= i) {
          fail(
            ['parents', bone],
            `parent "${parent}" must come before "${bone}" in bones`,
          );
        }
      }
    });
    if (known(rig.rootBone) && rig.parents[rig.rootBone] !== null) {
      fail(
        ['parents', rig.rootBone],
        `exactly one root is required: rootBone "${rig.rootBone}" must have a null parent`,
      );
    }
    const roots = rig.bones.filter(bone => rig.parents[bone] === null);
    if (roots.length === 1 && roots[0] !== rig.rootBone) {
      fail(
        ['rootBone'],
        `rootBone "${rig.rootBone}" is not the joint with the null parent ("${roots[0]}")`,
      );
    }

    const groupIds = new Set<string>();
    rig.skeletonGroups.forEach((group, i) => {
      if (groupIds.has(group.id)) {
        fail(
          ['skeletonGroups', i, 'id'],
          `duplicate skeleton group "${group.id}"`,
        );
      }
      groupIds.add(group.id);
      for (const bone of rig.bones) {
        if (group.restPose[bone] === undefined) {
          fail(
            ['skeletonGroups', i, 'restPose', bone],
            `skeleton group "${group.id}" has no rest pose for bone "${bone}"`,
          );
        }
      }
      for (const bone of Object.keys(group.restPose)) {
        if (!known(bone)) {
          fail(
            ['skeletonGroups', i, 'restPose', bone],
            `unknown bone "${bone}"`,
          );
        }
      }
    });
    if (!groupIds.has(rig.defaultSkeletonGroup)) {
      fail(
        ['defaultSkeletonGroup'],
        `defaultSkeletonGroup "${rig.defaultSkeletonGroup}" is not in skeletonGroups`,
      );
    }
  });

/** Inferred type of {@link rigDefinitionSchema}. */
export type RigDefinition = z.infer<typeof rigDefinitionSchema>;
