/**
 * Test-only builder of a character skeleton from a fixture rig (the shape M1-21
 * `createBodySkeleton` produces): bones in `rig.bones` order with rest TRS.
 * Never imported by runtime code.
 */
import {Bone, Object3D, Skeleton} from 'three';
import {rigDefinitionSchema} from '@csg/parts-schema';
import type {RigDefinition} from '@csg/parts-schema';
import {readFileSync} from 'node:fs';
import type {BodySkeleton} from '../contracts/composition';
import {restPoseForGroup} from '../rig';

/** Parses a rig fixture from `packages/engine/test/fixtures/rigs/`. */
export function loadFixtureRig(file: string): RigDefinition {
  const json = readFileSync(
    new URL(`../../test/fixtures/rigs/${file}`, import.meta.url),
    'utf8',
  );
  return rigDefinitionSchema.parse(JSON.parse(json));
}

/** Builds the character skeleton of `groupId`; world matrices are updated. */
export function createTestBody(
  rig: RigDefinition,
  groupId: string,
): BodySkeleton {
  const rest = restPoseForGroup(rig, groupId);
  if (rest === undefined) throw new Error(`unknown group ${groupId}`);
  const root = new Object3D();
  const bones = new Map<string, Bone>();
  for (const j of rest.joints) {
    const bone = new Bone();
    bone.name = j.name;
    bone.position.set(...j.translation);
    bone.quaternion.set(...j.rotation);
    bone.scale.set(...j.scale);
    bones.set(j.name, bone);
    (j.parent === null ? root : (bones.get(j.parent) as Bone)).add(bone);
  }
  const skeleton = new Skeleton([...bones.values()]);
  root.updateMatrixWorld(true);
  return {rig, skeletonGroupId: groupId, rest, root, bones, skeleton};
}
