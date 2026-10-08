/**
 * Export frame plan (spec 005 REQ-EXP-001 order, spec 004 REQ-ANM-007/010/011/012).
 * Pure and deterministic: the same settings and clip durations always give the
 * same job list (P-04). No GPU, no wall clock.
 */
import type {
  AnimationSelection,
  ClipRef,
  DirectionLabel,
  RenderSettings,
} from '@csg/parts-schema';
import {computeSampleTimes} from '../animation/sample-times';
import type {FrameJob} from '../contracts/pipeline';
import {directionLabels} from '../pipeline/directions';

/** The settings fields the plan reads; structural so tests can pass a subset. */
export interface PlanSettings {
  readonly directions: RenderSettings['directions'];
  readonly singleFacing: DirectionLabel;
  readonly animations: ReadonlyArray<AnimationSelection>;
}

/** East-facing source of each mirrored west-facing label (REQ-PIX-006). */
const MIRROR_SOURCE: Readonly<Partial<Record<DirectionLabel, DirectionLabel>>> =
  {w: 'e', nw: 'ne', sw: 'se'};

/**
 * Labels of the export's direction set in index order (REQ-PIX-005); index `i`
 * of the returned array is `FrameJob.direction = i`.
 *
 * @param settings Direction count and single facing.
 * @returns The labels.
 */
export function activeDirectionLabels(
  settings: Pick<PlanSettings, 'directions' | 'singleFacing'>,
): DirectionLabel[] {
  return directionLabels(settings.directions, settings.singleFacing);
}

/**
 * The clip a direction renders: the selection's `directionOverrides` entry for
 * that direction index, else its `clipId` (REQ-ANM-012).
 *
 * @param selection The animation selection.
 * @param direction Direction index in the active set.
 * @returns The clip reference.
 */
export function clipForDirection(
  selection: Pick<AnimationSelection, 'clipId' | 'directionOverrides'>,
  direction: number,
): ClipRef {
  return selection.directionOverrides?.[String(direction)] ?? selection.clipId;
}

/**
 * Source frame indices of one animation: `0..N-1`, followed by `N-2..1` when
 * `pingPong` and `bakePingPong` are both set (REQ-ANM-010, AC-ANM-010.2).
 *
 * @param selection The animation selection.
 * @returns Source indices in output order.
 */
export function sourceFrameIndices(
  selection: Pick<
    AnimationSelection,
    'frameCount' | 'pingPong' | 'bakePingPong'
  >,
): number[] {
  const n = selection.frameCount;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(i);
  if (selection.pingPong === true && selection.bakePingPong === true) {
    for (let i = n - 2; i >= 1; i--) out.push(i);
  }
  return out;
}

/**
 * For `mirrorWest` exports: the direction index whose frame is flipped to make
 * `direction` (`w` ← `e`, `nw` ← `ne`, `sw` ← `se`, REQ-PIX-006), or `null`
 * when `direction` is rendered, or the source is not in the active set.
 *
 * @param settings Direction count, single facing and `mirrorWest`.
 * @param direction Direction index in the active set.
 * @returns The east-facing source index, or `null`.
 */
export function mirrorSourceDirection(
  settings: Pick<PlanSettings, 'directions' | 'singleFacing'> & {
    readonly mirrorWest: boolean;
  },
  direction: number,
): number | null {
  if (!settings.mirrorWest) return null;
  const labels = activeDirectionLabels(settings);
  const label = labels[direction];
  const source = label === undefined ? undefined : MIRROR_SOURCE[label];
  if (source === undefined) return null;
  const index = labels.indexOf(source);
  return index < 0 ? null : index;
}

/**
 * Plans every export frame in REQ-EXP-001 order: animations in
 * `settings.animations` order, then direction index, then output frame.
 * Every direction of an animation uses the same sample times (REQ-ANM-011);
 * they come from {@link computeSampleTimes} with the duration of the clip the
 * direction renders (its override, REQ-ANM-012, or the selection's clip).
 * `durationMs` is `1000 / fps`. With `bakePingPong` the output frames
 * `N..2N-3` repeat source frames `N-2..1` (REQ-ANM-010). Mirrored directions
 * (`mirrorWest`) are still planned; the sampler decides via
 * {@link mirrorSourceDirection} whether to render or flip them.
 *
 * `ANM_FIXED_FPS_CLAMPED` warnings are not part of the plan; callers that
 * report them run {@link computeSampleTimes} themselves.
 *
 * @param settings Directions and animation selections.
 * @param durations Clip duration in seconds per `ClipRef`.
 * @returns The job list.
 * @throws Error when a planned clip has no duration in `durations`
 *   (the caller loads every clip first; programmer error).
 */
export function planFrames(
  settings: PlanSettings,
  durations: ReadonlyMap<ClipRef, number>,
): FrameJob[] {
  const directionCount = activeDirectionLabels(settings).length;
  const jobs: FrameJob[] = [];
  for (const selection of settings.animations) {
    const sources = sourceFrameIndices(selection);
    const durationMs = 1000 / selection.fps;
    for (let direction = 0; direction < directionCount; direction++) {
      const clipId = clipForDirection(selection, direction);
      const durationSec = durations.get(clipId);
      if (durationSec === undefined)
        throw new Error(`planFrames: no duration for clip ${clipId}`);
      const {times} = computeSampleTimes(selection, durationSec);
      sources.forEach((sourceFrame, frame) => {
        jobs.push({
          label: selection.label,
          clipId,
          direction,
          frame,
          sourceFrame,
          timeSec: times[sourceFrame] as number,
          durationMs,
        });
      });
    }
  }
  return jobs;
}
