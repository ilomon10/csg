/**
 * Animation contracts (spec 004). Type-only. Retargeting math lives in the
 * DOM-free `retarget/` module (REQ-ANM-023); these are the three adapters over it.
 */
import type {AnimationClip} from 'three';
import type {AnimationSelection, AnatomyParams} from '@csg/parts-schema';
import type {RetargetDrop} from '../retarget/types';
import type {AnatomyBinding} from './anatomy';
import type {BodySkeleton, AttachedPart} from './composition';
import type {EngineError, Result} from './errors';
import type {LoadedClip} from './registry';

/** A warning of {@link ComputeSampleTimes}. */
export interface SampleTimeWarning {
  readonly code: 'ANM_FIXED_FPS_CLAMPED';
  readonly frames: number[];
}

/** Result of {@link ComputeSampleTimes}. */
export interface SampleTimes {
  readonly times: number[];
  readonly warnings: SampleTimeWarning[];
}

/** Sample times in seconds, a pure function of the settings (P-04). */
export type ComputeSampleTimes = (
  selection: Pick<
    AnimationSelection,
    'frameCount' | 'fps' | 'loop' | 'timing' | 'range'
  >,
  durationSec: number,
) => SampleTimes;

/** Default frames per second for a frame count and clip duration (REQ-ANM-009). */
export type DefaultFps = (frameCount: number, durationSec: number) => number;

/** Output of {@link RetargetClip}. */
export interface RetargetedClip {
  readonly clip: AnimationClip;
  readonly dropped: readonly RetargetDrop[];
}

/**
 * Three adapter over `@csg/engine/retarget` (REQ-ANM-023). A clip whose skeleton
 * group equals the body's returns the input clip unchanged (same object);
 * otherwise a new clip with tracks renamed to target bone names and values
 * retargeted.
 */
export type RetargetClip = (
  clip: LoadedClip,
  body: BodySkeleton,
) => Result<RetargetedClip, EngineError>;

/** How the clip's root motion is applied (REQ-ANM-013). */
export type RootMotionMode = 'in-place' | 'metadata';

/** Plays one clip on one character skeleton. */
export interface ClipPlayer {
  /**
   * Retargets (LRU cache keyed `${clipRef}|${skeletonGroupId}`, cap 16 clips),
   * then applies the root-motion policy. `null` clears the clip.
   */
  setClip(clip: LoadedClip | null, rootMotion: RootMotionMode): void;
  /** Absolute seek; never accumulates (REQ-ANM-008) and allocates nothing per call. */
  seek(timeSec: number): void;
  /** Event log, for example `retarget:miss` and `retarget:hit`. */
  readonly log: readonly string[];
}

/** Creates a clip player bound to a character skeleton. */
export type CreateClipPlayer = (body: BodySkeleton) => ClipPlayer;

/** Inputs of {@link EvaluatePose}. */
export interface PoseContext {
  readonly body: BodySkeleton;
  readonly player: ClipPlayer;
  readonly anatomy: AnatomyBinding;
  readonly props: readonly AttachedPart[];
  readonly params: AnatomyParams;
}

/**
 * Fixed per-frame order (spec 002): sample, root motion, anatomy, ground
 * offset, sockets. Retargeting already happened at `setClip`.
 */
export type EvaluatePose = (context: PoseContext, timeSec: number) => void;
