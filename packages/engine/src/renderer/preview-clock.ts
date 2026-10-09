/**
 * Preview timing (spec 004 REQ-ANM-018). Pure functions: the renderer feeds
 * them the wall-clock time elapsed in `play()`, the only place wall-clock time
 * is read (P-04). Export never goes through here.
 */
import type {AnimationSelection} from '@csg/parts-schema';
import {computeSampleTimes} from '../animation/sample-times';
import {sourceFrameIndices} from '../sampler/frame-plan';

/**
 * Slack (in frames) added before flooring `elapsed * fps`, so an elapsed time
 * computed as `i / fps` (a seek, {@link previewElapsedFor}) shows frame `i`
 * even when `(i / fps) * fps` rounds to just below `i` (e.g. `1 / 49 * 49`).
 */
const FRAME_EPSILON = 1e-6;

/** Tolerance when matching a clip time to a sample time ({@link previewElapsedFor}). */
const TIME_EPSILON_SEC = 1e-6;

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
      /**
       * Clip times cycled in order, one per `1 / fps`: the export sample
       * times (`computeSampleTimes`), followed by those of frames `N-2..1`
       * when the selection ping-pongs (REQ-ANM-010). At least one.
       */
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
    const index = Math.floor(elapsed * timing.fps + FRAME_EPSILON) % n;
    return timing.times[index] ?? 0;
  }
  const d = timing.durationSec;
  if (d <= 0) return 0;
  return timing.loop ? elapsed % d : Math.min(elapsed, d);
}

/**
 * Inverse of {@link previewTimeAt}: the elapsed playback time at which the
 * preview shows clip time `timeSec`, so that playback resumed after a seek
 * continues from the sought frame (REQ-ANM-017, REQ-ANM-018).
 *
 * With export frames on, the shown frame is the first cycle position whose
 * sample time equals `timeSec` (± 1e-6 s; the forward pass of a ping-pong,
 * and the first of the fixed-fps frames clamped to the range end), else the
 * last position whose time lies before `timeSec`, else position 0. The
 * result is `position / fps`, whatever `fps` is relative to `N / D`.
 *
 * @param timing Preview timing.
 * @param timeSec Clip time in seconds (a sample time when seeking a frame).
 * @returns Elapsed playback time in seconds (≥ 0).
 */
export function previewElapsedFor(
  timing: PreviewTiming,
  timeSec: number,
): number {
  if (timing.showExportFrames) {
    const times = timing.times;
    if (times.length === 0 || !(timing.fps > 0)) return 0;
    let position = 0;
    for (let i = 0; i < times.length; i++) {
      const at = times[i] ?? 0;
      // The ping-pong return pass repeats earlier times: never prefer it.
      if (i > 0 && at < (times[i - 1] ?? 0)) break;
      if (Math.abs(at - timeSec) <= TIME_EPSILON_SEC) {
        position = i;
        break;
      }
      if (at < timeSec) position = i;
    }
    return position / timing.fps;
  }
  const t = Math.max(0, timeSec);
  const d = timing.durationSec;
  if (d <= 0) return 0;
  return timing.loop ? t : Math.min(t, d);
}

/**
 * Preview timing for an animation selection (REQ-ANM-018). With export
 * frames on, a ping-pong selection (`pingPong`, baked or not) cycles frames
 * `0..N-1` then `N-2..1`, the order a game plays the exported strip
 * (REQ-ANM-010).
 *
 * @param selection Frame count, fps, loop, timing, range and ping-pong of the clip.
 * @param durationSec Clip duration.
 * @param showExportFrames The "Show export frames" toggle (default on).
 * @returns The timing.
 */
export function previewTimingFor(
  selection: Pick<
    AnimationSelection,
    'frameCount' | 'fps' | 'loop' | 'timing' | 'range'
  > &
    Partial<Pick<AnimationSelection, 'pingPong' | 'bakePingPong'>>,
  durationSec: number,
  showExportFrames = true,
): PreviewTiming {
  if (showExportFrames) {
    const samples = computeSampleTimes(selection, durationSec).times;
    const order = sourceFrameIndices({
      frameCount: samples.length,
      pingPong: selection.pingPong,
      bakePingPong: selection.pingPong === true ? true : undefined,
    });
    return {
      showExportFrames: true,
      times: order.map(i => samples[i] ?? 0),
      fps: selection.fps,
    };
  }
  return {showExportFrames: false, durationSec, loop: selection.loop};
}
