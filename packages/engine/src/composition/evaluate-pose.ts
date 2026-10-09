/**
 * Per-frame pose evaluation in the fixed order of spec 002 (Data & contracts,
 * "Application order per frame"): 1) sample the clip (already retargeted onto
 * the character's skeleton group at `setClip`, spec 004 REQ-ANM-023);
 * 2) root-motion policy (spec 004 REQ-ANM-013); 3) anatomy (REQ-ANA-009/010);
 * 4) grounding offset (REQ-ANA-008); 5) socket props (REQ-ANA-007);
 * 6) skinning, which the renderer does when it draws.
 */
import {
  applyAnatomy,
  applyAnatomyToPose,
  computeGroundOffset,
  resetBodyToRest,
} from '../anatomy/apply';
import type {EvaluatePose} from '../contracts/animation';
import {updateSockets} from './sockets';

/**
 * Poses the character at an absolute clip time (REQ-ANM-008: never
 * accumulates, so the pose at `t` does not depend on earlier calls).
 *
 * - Every bone is first reset to its rest TRS, because anatomy multiplies
 *   bone scales (step 3 is not idempotent) and a clip may not animate every
 *   bone.
 * - Step 1: `context.player.seek(timeSec)` writes the sampled local pose; with
 *   no clip the skeleton stays in its bind pose.
 * - Step 2: the root-motion policy is part of the clip the player holds:
 *   `in-place` clips are stripped (or replaced by their in-place variant) once
 *   at `setClip`, so there is nothing to do per frame.
 * - Step 3: `applyAnatomyToPose`.
 * - Step 4: `body.root.position.y` is set to the cached bind-pose ground offset.
 * - Step 5: `updateSockets` refreshes world matrices and places the props.
 *
 * Deterministic: no wall clock, no randomness (P-04). Allocates nothing once
 * the anatomy parameters have been evaluated (the anatomy module caches per
 * parameter set).
 *
 * @param context Skeleton, player, anatomy binding, socket props, parameters.
 * @param timeSec Absolute clip time in seconds.
 */
export const evaluatePose: EvaluatePose = (context, timeSec) => {
  const {body, player, anatomy, props, params} = context;
  resetBodyToRest(anatomy);
  player.seek(timeSec); // 1
  // 2: applied at setClip (see TSDoc).
  applyAnatomyToPose(anatomy, params); // 3
  body.root.position.y = computeGroundOffset(anatomy, params); // 4
  updateSockets(body, props, applyAnatomy(anatomy, params)); // 5
};
