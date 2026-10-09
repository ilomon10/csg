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
  anatomySkinScales,
  anatomyUniformScales,
  applyAnatomyToPose,
  applyAnatomyToSkins,
  computeGroundOffset,
  defaultInheritScale,
  resetBodyToRest,
  socketPropScale,
  soleOffsetOf,
} from './apply';
