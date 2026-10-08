/**
 * Preview timing (spec 004 REQ-ANM-018). Pure functions: the renderer feeds
 * them the wall-clock time elapsed in `play()`, the only place wall-clock time
 * is read (P-04). Export never goes through here.
 */
import type {AnimationSelection} from '@csg/parts-schema';
import {computeSampleTimes} from '../animation/sample-times';

/**
 * How the preview maps elapsed wall-clock time to clip time.
 *
 * - `showExportFrames: true` (spec default): step through the export sample
 *   times at `fps`, so the preview shows exactly the exported frames.
 * - `showExportFrames: false`: continuous clip time (looping or clamped).
 */
export type PreviewTiming =
  | {
      readonly showExportFrames: true;
      /** Export sample times (`computeSampleTimes`), at least one. */
      readonly times: readonly number[];
      readonly fps: number;
    }
  | {
      readonly showExportFrames: false;
      readonly durationSec: number;
      readonly loop: boolean;
    };

/**
 * Clip time shown after `elapsedSec` of playback.
 *
 * @param timing Preview timing.
 * @param elapsedSec Elapsed playback time in seconds (≥ 0).
 * @returns Clip time in seconds.
 */
export function previewTimeAt(
  timing: PreviewTiming,
  elapsedSec: number,
): number {
  const elapsed = Math.max(0, elapsedSec);
  if (timing.showExportFrames) {
    const n = timing.times.length;
    if (n === 0) return 0;
    const index = Math.floor(elapsed * timing.fps) % n;
    return timing.times[index] ?? 0;
  }
  const d = timing.durationSec;
  if (d <= 0) return 0;
  return timing.loop ? elapsed % d : Math.min(elapsed, d);
}

/**
 * Preview timing for an animation selection (REQ-ANM-018).
 *
 * @param selection Frame count, fps, loop, timing and range of the clip.
 * @param durationSec Clip duration.
 * @param showExportFrames The "Show export frames" toggle (default on).
 * @returns The timing.
 */
export function previewTimingFor(
  selection: Pick<
    AnimationSelection,
    'frameCount' | 'fps' | 'loop' | 'timing' | 'range'
  >,
  durationSec: number,
  showExportFrames = true,
): PreviewTiming {
  if (showExportFrames) {
    return {
      showExportFrames: true,
      times: computeSampleTimes(selection, durationSec).times,
      fps: selection.fps,
    };
  }
  return {showExportFrames: false, durationSec, loop: selection.loop};
}
