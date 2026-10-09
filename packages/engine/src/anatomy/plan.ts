import type {AnatomyParams} from '@csg/parts-schema';
import type {AnatomyBinding} from '../contracts/anatomy';

/** How one parameter scales the joints it lists (REQ-ANA-001 table). */
export type ScaleMode = 'uniform-subtree' | 'length-axis' | 'cross-axes';

/** Parameter to scale mode (REQ-ANA-001, REQ-ANA-003/004/005). */
export const SCALE_MODES: Readonly<Record<keyof AnatomyParams, ScaleMode>> = {
  height: 'uniform-subtree',
  head: 'uniform-subtree',
  torsoWidth: 'cross-axes',
  shoulders: 'length-axis',
  armLength: 'length-axis',
  legLength: 'length-axis',
  hands: 'uniform-subtree',
  feet: 'uniform-subtree',
  limbThickness: 'cross-axes',
};

/** Precomputed joint indices of one binding (rig order, parents first). */
export interface AnatomyPlan {
  readonly names: readonly string[];
  /** Parent index per joint, -1 for the root. */
  readonly parent: readonly number[];
  /** Joint indices per parameter, from `rig.anatomyBones`. */
  readonly joints: Readonly<Record<keyof AnatomyParams, readonly number[]>>;
  /** Local axis index (0 x, 1 y, 2 z) of bone length. */
  readonly lengthAxis: 0 | 1 | 2;
  /** Indices of the feet joints and their descendants (ground contact). */
  readonly feet: readonly number[];
}

const PLANS = new WeakMap<AnatomyBinding, AnatomyPlan>();

/** Stores the plan computed by `createAnatomyBinding`. */
export function setPlan(binding: AnatomyBinding, plan: AnatomyPlan): void {
  PLANS.set(binding, plan);
}

/**
 * The plan of a binding made by `createAnatomyBinding`.
 *
 * @throws Error for a binding that was not made by `createAnatomyBinding`.
 */
export function planOf(binding: AnatomyBinding): AnatomyPlan {
  const plan = PLANS.get(binding);
  if (plan === undefined) {
    throw new Error('anatomy binding was not made by createAnatomyBinding');
  }
  return plan;
}
