/**
 * Sample times (spec 004 REQ-ANM-007, REQ-ANM-009). Pure functions of the clip settings: no
 * wall clock, no random, no mixer time (AC-ANM-007.4).
 */
import type {
  ComputeSampleTimes,
  DefaultFps,
  SampleTimeWarning,
} from '../contracts/animation';

/**
 * Sample times in seconds for one animation (REQ-ANM-007). `range` defaults to
 * `[0, durationSec]`, `timing` to `fit`. `fit` + `loop` spreads `N` frames over `D` without
 * repeating the first pose; `fit` without `loop` includes the first and last pose;
 * `fixed-fps` steps by `1 / fps` and clamps to the range end, reporting
 * `ANM_FIXED_FPS_CLAMPED` with the frame indices that reached the end (AC-ANM-007.3).
 */
export const computeSampleTimes: ComputeSampleTimes = (
  selection,
  durationSec,
) => {
  const n = selection.frameCount;
  const s = selection.range?.startSec ?? 0;
  const e = selection.range?.endSec ?? durationSec;
  const d = e - s;
  const times: number[] = new Array<number>(n);
  const warnings: SampleTimeWarning[] = [];
  if (selection.timing === 'fixed-fps') {
    const clamped: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = s + i / selection.fps;
      if (i > 0 && t >= e) clamped.push(i);
      times[i] = Math.min(t, e);
    }
    if (clamped.length > 0) {
      warnings.push({code: 'ANM_FIXED_FPS_CLAMPED', frames: clamped});
    }
  } else if (selection.loop) {
    for (let i = 0; i < n; i++) times[i] = s + (i * d) / n;
  } else {
    for (let i = 0; i < n; i++) {
      times[i] = n >= 2 ? Math.min(s + (i * d) / (n - 1), e) : s;
    }
  }
  return {times, warnings};
};

/** Default fps for `fit` timing: `round(N / D)` clamped to 1-60 (REQ-ANM-009). */
export const defaultFps: DefaultFps = (frameCount, durationSec) => {
  const raw = durationSec > 0 ? frameCount / durationSec : 60;
  return Math.min(60, Math.max(1, Math.round(raw)));
};

/** Playback speed relative to the source clip, `fps * D / N`, rounded to 1 decimal (AC-ANM-009.1). */
export function playbackSpeed(
  fps: number,
  durationSec: number,
  frameCount: number,
): number {
  return Math.round((fps * durationSec * 10) / frameCount) / 10;
}
