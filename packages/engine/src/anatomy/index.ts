/**
 * Anatomy module (spec 002): bone scales with child compensation, grounding
 * and socket scale rules, all on the character skeleton's rest pose. DOM-free;
 * uses three math only.
 */
export type {
  AnatomyBinding,
  AnatomyScales,
  ApplyAnatomy,
  ComputeGroundOffset,
  CreateAnatomyBinding,
} from '../contracts/anatomy';
export {createAnatomyBinding} from './binding';
export {
  applyAnatomy,
  applyAnatomyToPose,
  computeGroundOffset,
  defaultInheritScale,
  resetBodyToRest,
  socketPropScale,
} from './apply';
