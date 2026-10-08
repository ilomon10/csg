import {ANATOMY_PARAM_KEYS} from '@csg/parts-schema';
import type {AnatomyParams} from '@csg/parts-schema';
import type {CreateAnatomyBinding} from '../contracts/anatomy';
import {subtreeJoints} from '../rig';
import {setPlan} from './plan';
import type {AnatomyPlan} from './plan';

const AXES = {x: 0, y: 1, z: 2} as const;

/**
 * Resolves `rig.anatomyBones` against the character skeleton (REQ-ANA-002).
 * Every listed joint, and the whole rig, must exist in `body.bones` and
 * `body.rest`, matched case-sensitively (REQ-ANA-020); otherwise the result is
 * `AST_RIG_MISMATCH` with the sorted `details.missing`.
 */
export const createAnatomyBinding: CreateAnatomyBinding = (rig, body) => {
  const index = new Map<string, number>();
  const names: string[] = [];
  const parent: number[] = [];
  for (const j of body.rest.joints) {
    index.set(j.name, names.length);
    names.push(j.name);
    parent.push(j.parent === null ? -1 : (index.get(j.parent) ?? -1));
  }
  const missing = new Set<string>();
  const joints = {} as Record<keyof AnatomyParams, number[]>;
  for (const key of ANATOMY_PARAM_KEYS) {
    joints[key] = [];
    for (const name of rig.anatomyBones[key]) {
      const i = index.get(name);
      if (i === undefined || !body.bones.has(name)) missing.add(name);
      else joints[key].push(i);
    }
  }
  if (missing.size > 0) {
    const sorted = [...missing].sort();
    return {
      ok: false,
      error: {
        code: 'AST_RIG_MISMATCH',
        message: `character skeleton "${body.skeletonGroupId}" lacks anatomy joints: ${sorted.join(', ')}`,
        details: {missing: sorted},
      },
    };
  }
  const feet = subtreeJoints(
    body.rest,
    joints.feet.map(i => names[i] as string),
  ).map(name => index.get(name) as number);
  const plan: AnatomyPlan = {
    names,
    parent,
    joints,
    lengthAxis: AXES[rig.lengthAxis],
    feet,
  };
  const binding = {rig, body};
  setPlan(binding, plan);
  return {ok: true, value: binding};
};
