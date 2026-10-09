/**
 * Composition contracts (spec 001 REQ-CMP-*, spec 002 REQ-ANA-007, spec 011
 * REQ-AST-028). Type-only.
 */
import type {Bone, Color, Object3D, Skeleton} from 'three';
import type {
  AssetRef,
  BodyRegion,
  HexColor,
  PartEntry,
  PartSocket,
  RigDefinition,
  SkeletonGroupId,
  TintSlot,
} from '@csg/parts-schema';
import type {RestPose} from '../retarget/types';
import type {AnatomyScales} from './anatomy';
import type {EngineError, Result} from './errors';
import type {LoadedPartInternal} from './registry';

/**
 * The character skeleton, built from rig data (rest TRS of one skeleton group),
 * not from the body GLB (REQ-CMP-037). The body is attached like any skinned part.
 * Bones are created in `rig.bones` order with rest TRS.
 */
export interface BodySkeleton {
  readonly rig: RigDefinition;
  /** The skeleton group whose rest pose built this skeleton. */
  readonly skeletonGroupId: SkeletonGroupId;
  readonly rest: RestPose;
  readonly root: Object3D;
  /** Bones by exact joint name (case-sensitive, REQ-ANA-020). */
  readonly bones: ReadonlyMap<string, Bone>;
  readonly skeleton: Skeleton;
}

/** Builds the character skeleton from a rest pose. */
export type CreateBodySkeleton = (
  rig: RigDefinition,
  rest: RestPose,
) => Result<BodySkeleton, EngineError>;

/** A part attached to the scene. */
export interface AttachedPart {
  readonly ref: AssetRef;
  readonly object: Object3D;
  setVisible(visible: boolean): void;
  dispose(): void;
}

/** Options of {@link AttachSkinnedPart}. */
export interface AttachSkinnedOptions {
  /** Target bone name to part bone name; default identity by name. */
  readonly boneMap?: ReadonlyMap<string, string>;
}

/**
 * Rebinds a skinned part to the character skeleton by bone name and keeps the
 * part's own `boneInverses` (REQ-CMP-037). A missing bone yields
 * `AST_RIG_MISMATCH` with `details.missing`.
 */
export type AttachSkinnedPart = (
  part: LoadedPartInternal,
  body: BodySkeleton,
  options?: AttachSkinnedOptions,
) => Result<AttachedPart, EngineError>;

/**
 * Attaches a static prop to the bone `rig.socketBones[socket.bone]`
 * (REQ-ANA-019), applying `socket.offset`.
 */
export type AttachStaticPart = (
  part: LoadedPartInternal,
  body: BodySkeleton,
  socket: PartSocket,
) => Result<AttachedPart, EngineError>;

/**
 * Pipeline step 5: keeps props at their socket joint's world position and
 * orientation under anatomy; applies the joint's scale only where
 * `socket.inheritScale` is true (REQ-ANA-007).
 */
export type UpdateSockets = (
  body: BodySkeleton,
  props: readonly AttachedPart[],
  scales: AnatomyScales,
) => void;

/** A uniform holder; `value` is mutated in place, no recompile (REQ-CMP-011). */
export interface UniformRef<T> {
  value: T;
}

/** One color uniform per tint slot. */
export type TintUniforms = Readonly<Record<TintSlot, UniformRef<Color>>>;

/** Creates the tint uniforms from initial hex colors. */
export type CreateTintUniforms = (
  initial: Readonly<Record<TintSlot, HexColor>>,
) => TintUniforms;

/**
 * Bit mask of hidden body regions: bit `i` is `BODY_REGIONS[i]`
 * (REQ-AST-025). The mask is a uniform; `regionId` is the Float32 vertex
 * attribute (REQ-AST-028).
 */
export type RegionMask = UniformRef<number>;

/** Mask value for a set of hidden regions. */
export type RegionMaskOf = (hidden: readonly BodyRegion[]) => number;

/**
 * Replaces the part's materials with unlit node materials: `colorNode` is
 * `texture x tint` (multiply) or `tint` (replace) per `entry.tintSlots`
 * (REQ-CMP-014); with a mask, fragments whose `regionId` bit is set are discarded.
 */
export type ApplyTintMaterial = (
  part: LoadedPartInternal,
  map: PartEntry['tintSlots'],
  uniforms: TintUniforms,
  mask?: RegionMask,
) => void;
