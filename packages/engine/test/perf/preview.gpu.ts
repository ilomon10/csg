/**
 * Preview performance (M2-19): the perf character (8 equipped parts) at 64 px with the default
 * pipeline, played continuously through the renderer's own animation loop.
 *
 * - AC-PIX-032.1 / AC-GEN-007.2: over 10 s of preview the p95 frame time is <= 16.7 ms.
 *   "Frame time" is the interval between drawn preview frames (the renderer's loop calls
 *   `draw()` once per animation frame), so a frame that overruns the display interval shows up
 *   as a long interval. The report adds the CPU time of each draw (`pipeline.render()`) and
 *   the serial GPU cost of a frame (draw + wait until the GPU is idle), which bound how much
 *   headroom the 16.7 ms budget has independent of the display rate.
 * - AC-PIX-032.2 (P2): the same at 128 px, reported only.
 */
import {defaultRenderSettings} from '@csg/parts-schema';
import {afterEach, describe, expect, it} from 'vitest';
import type {RenderSettings} from '../../src/contracts/pipeline';
import {
  createPerfRenderer,
  ms,
  perfGate,
  reportEnvironment,
  runPreviewLoop,
  serialFrameCost,
  summary,
  writePerfReport,
} from './perf-harness';
import type {PerfRenderer} from './perf-harness';

const WALK = 'builtin:quaternius-ual/walk';
const PREVIEW_MS = 10_000;
const SERIAL_FRAMES = 240;
const FRAME_BUDGET_MS = 16.7;
/**
 * Gate allowance on the measured interval (reason): at 60 Hz the interval cannot be shorter than
 * the 16.67 ms display period, and rAF timestamps are coarsened to 0.1 ms without cross-origin
 * isolation, so on-time frames read 16.6 to 16.8 ms. A missed frame reads >= 33 ms, so 0.5 ms of
 * allowance cannot hide one.
 */
const TIMER_ALLOWANCE_MS = 0.5;

function previewSettings(size: number): RenderSettings {
  const s = defaultRenderSettings('three-quarter');
  return {
    ...s,
    resolution: {width: size, height: size},
    directions: 8,
    animations: [
      {clipId: WALK, label: 'walk', frameCount: 8, fps: 8, loop: true},
    ],
  };
}

let live: PerfRenderer | undefined;
afterEach(() => {
  live?.dispose();
  live = undefined;
});

async function measure(size: number): Promise<{
  report: Record<string, unknown>;
  p95: number;
}> {
  live = await createPerfRenderer({settings: previewSettings(size)});
  const loop = await runPreviewLoop(live, WALK, PREVIEW_MS);
  const serial = await serialFrameCost(live, SERIAL_FRAMES);
  const intervals = summary(loop.intervals);
  const elapsedSec = PREVIEW_MS / 1000;
  const report = {
    resolution: size,
    parts: 8,
    ...(await reportEnvironment(live.renderer.renderer)),
    budgetP95Ms: FRAME_BUDGET_MS,
    durationMs: PREVIEW_MS,
    framesDrawn: loop.frames,
    fps: ms(loop.frames / elapsedSec),
    frameIntervalMs: intervals,
    drawCpuMs: summary(loop.drawCpu),
    serialFrameMs: summary(serial),
  };
  live.dispose();
  live = undefined;
  return {report, p95: intervals.p95};
}

describe('preview performance (M2-19)', () => {
  it('AC-PIX-032.1, AC-GEN-007.2: 8 parts at 64 px, p95 frame time <= 16.7 ms over 10 s', async () => {
    const {report, p95} = await measure(64);
    await writePerfReport('preview-64', {
      ac: ['AC-PIX-032.1', 'AC-GEN-007.2'],
      ...report,
    });
    expect(Number.isFinite(p95)).toBe(true);
    if (await perfGate())
      expect(p95).toBeLessThanOrEqual(FRAME_BUDGET_MS + TIMER_ALLOWANCE_MS);
  }, 120_000);

  it('AC-PIX-032.2 (P2, report only): 8 parts at 128 px', async () => {
    const {report, p95} = await measure(128);
    await writePerfReport('preview-128', {ac: ['AC-PIX-032.2'], ...report});
    expect(Number.isFinite(p95)).toBe(true);
  }, 120_000);
});
