import {describe, expect, it} from 'vitest';
import {computeSampleTimes} from '../animation/sample-times';
import {
  previewElapsedFor,
  previewTimeAt,
  previewTimingFor,
} from './preview-clock';
import type {PreviewTiming} from './preview-clock';

/** Clip times shown from a seek to `timeSec` for the next `count` frame periods. */
function framesAfterSeek(
  timing: PreviewTiming & {showExportFrames: true},
  timeSec: number,
  count: number,
): number[] {
  const start = previewElapsedFor(timing, timeSec);
  const shown: number[] = [];
  for (let k = 0; k < count; k++) {
    // Sample mid-period, and at the very start of the period after a seek.
    const offset = k === 0 ? 0 : (k + 0.5) / timing.fps;
    shown.push(previewTimeAt(timing, start + offset));
  }
  return shown;
}

/** Narrows a timing to the export-frames variant (test helper). */
function exportFrames(
  timing: PreviewTiming,
): PreviewTiming & {showExportFrames: true} {
  if (!timing.showExportFrames) throw new Error('expected export frames');
  return timing;
}

describe('preview seek inverts playback timing (REQ-ANM-017, REQ-ANM-018)', () => {
  it('AC-ANM-017.1 / AC-ANM-018.1 / AC-ANM-018.4: with fps != N/D, play after a seek continues from every sought frame', () => {
    // N/D = 8 frames per second, played at 5, 12 and 49 fps (49: `1 / 49 * 49 < 1`).
    for (const fps of [5, 12, 49]) {
      const selection = {frameCount: 8, fps, loop: true} as const;
      const times = computeSampleTimes(selection, 1).times;
      const timing = exportFrames(previewTimingFor(selection, 1));
      for (let i = 0; i < times.length; i++) {
        const expected = [0, 1, 2].map(k => times[(i + k) % times.length]);
        expect(framesAfterSeek(timing, times[i] ?? -1, 3)).toEqual(expected);
      }
    }
  });

  it('AC-ANM-017.1 / AC-ANM-018.1: a seek to the last frame holds it a full period, then wraps to frame 0', () => {
    // 8 frames over 1.6 s at 3 fps: the old `elapsed = t` mapping showed frame floor(1.4 * 3) = 4.
    const selection = {frameCount: 8, fps: 3, loop: true} as const;
    const times = computeSampleTimes(selection, 1.6).times;
    const timing = exportFrames(previewTimingFor(selection, 1.6));
    const start = previewElapsedFor(timing, times[7] ?? -1);
    expect(start).toBeCloseTo(7 / 3, 12);
    expect(previewTimeAt(timing, start)).toBe(times[7]);
    expect(previewTimeAt(timing, start + 0.99 / 3)).toBe(times[7]);
    expect(previewTimeAt(timing, start + 1.01 / 3)).toBe(times[0]);
    // A non-looping fit clip seeks its last pose (t = D) the same way.
    const once = {frameCount: 6, fps: 10, loop: false} as const;
    const onceTimes = computeSampleTimes(once, 2).times;
    expect(onceTimes[5]).toBe(2);
    expect(
      framesAfterSeek(exportFrames(previewTimingFor(once, 2)), 2, 2),
    ).toEqual([onceTimes[5], onceTimes[0]]);
  });

  it('AC-ANM-017.1: a seek to a fixed-fps frame clamped to the range end resumes from the first clamped frame', () => {
    const selection = {
      frameCount: 6,
      fps: 4,
      loop: false,
      timing: 'fixed-fps',
    } as const;
    const timing = exportFrames(previewTimingFor(selection, 1));
    expect(timing.times).toEqual([0, 0.25, 0.5, 0.75, 1, 1]);
    expect(previewElapsedFor(timing, 1)).toBe(4 / 4);
    expect(framesAfterSeek(timing, 1, 3)).toEqual([1, 1, 0]);
  });

  it('AC-ANM-010.1 / AC-ANM-017.1 / AC-ANM-018.3: ping-pong previews 0..N-1..1 and a seek resumes on the forward pass', () => {
    const base = {frameCount: 5, fps: 7, loop: true} as const;
    const times = computeSampleTimes(base, 1).times;
    const pingPong = (i: number) => times[[0, 1, 2, 3, 4, 3, 2, 1][i] ?? -1];
    for (const bakePingPong of [false, true]) {
      const timing = exportFrames(
        previewTimingFor({...base, pingPong: true, bakePingPong}, 1),
      );
      expect(timing.times).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map(pingPong));
      // Frame 3 (forward pass): 3, 4, then back down 3, 2.
      expect(framesAfterSeek(timing, times[3] ?? -1, 4)).toEqual([
        times[3],
        times[4],
        times[3],
        times[2],
      ]);
      // The last frame turns around; frame 1 is followed by the wrap to frame 0 only
      // after the return pass.
      expect(framesAfterSeek(timing, times[4] ?? -1, 3)).toEqual([
        times[4],
        times[3],
        times[2],
      ]);
      expect(framesAfterSeek(timing, times[0] ?? -1, 2)).toEqual([
        times[0],
        times[1],
      ]);
    }
    // Without ping-pong the cycle is the export order.
    expect(exportFrames(previewTimingFor(base, 1)).times).toEqual(times);
  });

  it('AC-ANM-017.1: a time between sample times resumes from the frame shown before it', () => {
    const selection = {frameCount: 4, fps: 3, loop: true} as const;
    const timing = exportFrames(previewTimingFor(selection, 1));
    expect(previewElapsedFor(timing, 0.6)).toBe(2 / 3);
    expect(previewElapsedFor(timing, -1)).toBe(0);
  });

  it('AC-ANM-018.2: with export frames off, a seek resumes at the sought clip time', () => {
    const looping = previewTimingFor(
      {frameCount: 8, fps: 5, loop: true},
      2,
      false,
    );
    expect(
      previewTimeAt(looping, previewElapsedFor(looping, 1.9) + 0.05),
    ).toBeCloseTo(1.95, 12);
    const clamped = previewTimingFor(
      {frameCount: 8, fps: 5, loop: false},
      2,
      false,
    );
    expect(previewElapsedFor(clamped, 3)).toBe(2);
    expect(previewElapsedFor(clamped, -1)).toBe(0);
  });
});
