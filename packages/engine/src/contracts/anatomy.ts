/**
 * Anatomy contracts (spec 002). Type-only; implementations are DOM-free and use
 * three math only.
 */
import type {Vector3} from 'three';
import type {AnatomyParams, RigDefinition} from '@csg/parts-schema';
import type {BodySkeleton} from './composition';
import type {EngineError, Result} from './errors';

/** Per-joint scale applied by anatomy, keyed by exact joint name. */
export type AnatomyScales = ReadonlyMap<string, Vector3>;

/**
 * Anatomy resolved against one character skeleton: joints per control
 * (`rig.anatomyBones`) and bind-pose data from `body.rest`, never from the
 * body GLB (REQ-CMP-037).
 */
export interface AnatomyBinding {
  readonly rig: RigDefinition;
  readonly body: BodySkeleton;
}

/** Resolves `anatomyBones` against the skeleton; a missing joint yields `AST_RIG_MISMATCH`. */
export type CreateAnatomyBinding = (
  rig: RigDefinition,
  body: BodySkeleton,
) => Result<AnatomyBinding, EngineError>;

/** Pipeline step 3 (after sampling): applies anatomy scales to the bones. */
export type ApplyAnatomy = (
  binding: AnatomyBinding,
  params: AnatomyParams,
) => AnatomyScales;

/**
 * Pipeline step 4 (REQ-ANA-008): vertical offset that puts the sole on y = 0
 * in the bind pose: the lowest feet joint, lowered by the character skeleton
 * group's `soleOffsetM` scaled by `height × feet`. Joint-only, cached.
 */
export type ComputeGroundOffset = (
  binding: AnatomyBinding,
  params: AnatomyParams,
) => number;
