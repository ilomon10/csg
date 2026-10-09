/**
 * composition module (spec 001 REQ-CMP-*, spec 002 REQ-ANA-006/007/019, spec
 * 011 REQ-AST-025/026/028): character skeleton, skinned and static part
 * attachment, sockets, tints, region hides, diff-based assembly and the
 * per-frame pose evaluation.
 */
export type {
  AttachSkinnedOptions,
  AttachSkinnedPart,
  AttachStaticOptions,
  AttachStaticPart,
  AttachedPart,
  ApplyTintMaterial,
  BodySkeleton,
  CreateBodySkeleton,
  CreateTintUniforms,
  MaterialLinker,
  RegionMask,
  RegionMaskOf,
  TintUniforms,
  UniformRef,
  UpdateSockets,
} from '../contracts/composition';
export {BODY_SKELETON_ROOT_NAME, createBodySkeleton} from './body-skeleton';
export {attachSkinnedPart} from './attach-skinned-part';
export type {ParentMismatch} from './attach-skinned-part';
export {attachStaticPart} from './attach-static-part';
export {
  SCALE_INHERITING_SOCKET,
  resolveSocketBone,
  resolveSocketJoint,
  socketInheritsScale,
  updateSockets,
} from './sockets';
export {
  DEFAULT_TINT_MODE,
  TINT_SLOT_USER_DATA,
  applyTintMaterial,
  createPartMaterials,
  createTintUniform,
  createTintUniforms,
  restoreMaterials,
  setTint,
} from './tint-material';
export type {
  PartMaterials,
  PartMaterialsOptions,
  TintMaterialOptions,
} from './tint-material';
export {
  HAIR_SLOT,
  REGION_ID_ATTRIBUTE,
  computeHides,
  createRegionMask,
  isRegionHidden,
  regionMaskOf,
  regionVisibleNode,
  setRegionMask,
} from './region-mask';
export type {EquippedPartHides, HideState} from './region-mask';
export {
  CHARACTER_ROOT_NAME,
  ENGINE_DISPOSED,
  createCharacterAssembly,
} from './character-assembly';
export type {
  AssembledPart,
  AssemblyRegistry,
  CharacterAssembly,
  CharacterAssemblyOptions,
  HiddenSlot,
} from './character-assembly';
export {evaluatePose} from './evaluate-pose';
