/**
 * Settings-change latency and palette LUT build (M2-19), through the character renderer with the
 * perf character at 64 px. Each latency is "call `setRenderSettings` -> the new preview frame is
 * drawn -> the GPU has finished it" (`gpuIdle`, no readback; the preview presents to the canvas
 * and never reads back). The frame is then read to check that it changed (not timed).
 *
 * - REQ-PIX-034 / AC-PIX-034.1: a uniform-only change (rim strength) rebuilds nothing; latency
 *   reported.
 * - AC-PIX-034.2: `bayer4` -> `bayer8` shows the new frame within 300 ms (cold: first compile of
 *   the new post shader; warm: switching back and forth with cached pipelines).
 * - AC-PIX-021.2: a 256-color LUT built in the worker in <= 250 ms; the renderer builds it off
 *   the main thread (longest main-thread stall reported) and the preview keeps the previous
 *   palette until it is ready.
 */
import {defaultRenderSettings} from '@csg/parts-schema';
import {afterEach, describe, expect, it} from 'vitest';
import type {RenderSettings} from '../../src/contracts/pipeline';
import {
  buildPaletteLut,
  createPaletteLutWorker,
} from '../../src/pipeline/palette-lut';
import {
  createPerfRenderer,
  gpuIdle,
  ms,
  perfGate,
  reportEnvironment,
  summary,
  writePerfReport,
  yieldTask,
} from './perf-harness';
import type {PerfRenderer} from './perf-harness';

const WALK = 'builtin:quaternius-ual/walk';
const REBUILD_BUDGET_MS = 300;
const LUT_BUDGET_MS = 250;

function baseSettings(): RenderSettings {
  const s = defaultRenderSettings('three-quarter');
  return {
    ...s,
    resolution: {width: 64, height: 64},
    directions: 8,
    palette: {
      ...s.palette,
      id: 'pico-8',
      dither: {mode: 'bayer4', strength: 1},
    },
    animations: [
      {clipId: WALK, label: 'walk', frameCount: 8, fps: 8, loop: true},
    ],
  };
}

/** 256 distinct deterministic colors (no Math.random). */
function bigPalette(seed = 1): string[] {
  return Array.from({length: 256}, (_, i) => {
    const v = (Math.imul(i + seed, 2654435761) >>> 8) & 0xffffff;
    return `#${v.toString(16).padStart(6, '0')}`;
  });
}

/** Runs `fn` while measuring the longest main-thread gap between two yielded tasks. */
async function withStallMonitor<T>(
  fn: () => Promise<T>,
): Promise<{value: T; maxStallMs: number}> {
  let done = false;
  let maxStallMs = 0;
  const monitor = (async () => {
    let last = performance.now();
    while (!done) {
      await yieldTask();
      const now = performance.now();
      maxStallMs = Math.max(maxStallMs, now - last);
      last = now;
    }
  })();
  try {
    const value = await fn();
    return {value, maxStallMs};
  } finally {
    done = true;
    await monitor;
  }
}

/** Applies settings and waits until the redrawn frame is finished on the GPU. */
async function applyAndShow(
  p: PerfRenderer,
  next: RenderSettings,
): Promise<{ms: number; maxStallMs: number; frame: Uint8ClampedArray}> {
  const r = p.renderer;
  const before = r.pipelineStats.frames;
  const t0 = performance.now();
  const {value: res, maxStallMs} = await withStallMonitor(async () => {
    const out = await r.setRenderSettings(next);
    await gpuIdle(r.renderer);
    return out;
  });
  const elapsed = performance.now() - t0;
  if (!res.ok) throw new Error(res.error.message);
  expect(r.pipelineStats.frames).toBeGreaterThan(before);
  return {ms: elapsed, maxStallMs, frame: await r.readCell()};
}

let live: PerfRenderer | undefined;
afterEach(() => {
  live?.dispose();
  live = undefined;
});

describe('settings latency (M2-19)', () => {
  it('AC-PIX-034.1, AC-PIX-034.2, AC-PIX-021.2: uniform change, bayer4 -> bayer8 rebuild and 256-color palette latency, previous palette shown while the LUT builds', async () => {
    live = await createPerfRenderer({settings: baseSettings()});
    const r = live.renderer;
    const base = baseSettings();
    r.seek(0.2);
    await gpuIdle(r.renderer);
    const first = await r.readCell();

    // Uniform-only (REQ-PIX-034): rim strength, 10 times.
    const rebuilds0 = r.pipelineStats.rebuilds;
    const uniform: number[] = [];
    for (let i = 1; i <= 10; i++) {
      const s = {
        ...base,
        toon: {...base.toon, rim: {...base.toon.rim, strength: i / 10}},
      };
      uniform.push((await applyAndShow(live, s)).ms);
    }
    expect(r.pipelineStats.rebuilds).toBe(rebuilds0);
    await applyAndShow(live, base);

    // Structural (AC-PIX-034.2): bayer4 -> bayer8, cold then warm toggles.
    const bayer8: RenderSettings = {
      ...base,
      palette: {...base.palette, dither: {mode: 'bayer8', strength: 1}},
    };
    const cold = await applyAndShow(live, bayer8);
    expect(Array.from(cold.frame)).not.toEqual(Array.from(first));
    const warm: number[] = [];
    for (let i = 0; i < 6; i++) {
      warm.push((await applyAndShow(live, i % 2 === 0 ? base : bayer8)).ms);
    }

    // Palette: 256 colors (LUT build) through the renderer. The toggles end
    // on bayer8; keep it, so only the palette changes (no shader rebuild).
    const custom: RenderSettings = {
      ...bayer8,
      palette: {...bayer8.palette, id: 'custom', colors: bigPalette()},
    };
    const palette = await applyAndShow(live, custom);

    // AC-PIX-021.2: while the next LUT builds, the lock is free and the
    // preview still draws with the previous palette.
    const shown = palette.frame;
    const next: RenderSettings = {
      ...bayer8,
      palette: {...bayer8.palette, id: 'custom', colors: bigPalette(977)},
    };
    const pending = r.setRenderSettings(next);
    expect(r.busy).toBe(false);
    r.draw();
    await gpuIdle(r.renderer);
    expect(Array.from(await r.readCell())).toEqual(Array.from(shown));
    const applied = await pending;
    expect(applied.ok).toBe(true);
    await gpuIdle(r.renderer);
    expect(Array.from(await r.readCell())).not.toEqual(Array.from(shown));

    // LUT build alone: worker vs main thread (AC-PIX-021.2).
    const worker = createPaletteLutWorker({
      createWorker: () =>
        new Worker(
          new URL('../../src/pipeline/palette-lut.worker.ts', import.meta.url),
          {type: 'module'},
        ),
    });
    let workerMs: number;
    let mainMs: number;
    try {
      await worker.build(['#000000'], 'oklab'); // worker start-up
      const t0 = performance.now();
      await worker.build(bigPalette(), 'oklab');
      workerMs = performance.now() - t0;
      const t1 = performance.now();
      buildPaletteLut(bigPalette(), 'oklab');
      mainMs = performance.now() - t1;
    } finally {
      worker.dispose();
    }

    await writePerfReport('settings-latency', {
      ac: ['AC-PIX-034.1', 'AC-PIX-034.2', 'AC-PIX-021.2'],
      ...(await reportEnvironment(r.renderer)),
      measure:
        'setRenderSettings -> preview frame drawn -> GPU idle (no readback)',
      budgets: {rebuildMs: REBUILD_BUDGET_MS, lutWorkerMs: LUT_BUDGET_MS},
      uniformChangeMs: summary(uniform),
      bayer4ToBayer8ColdMs: ms(cold.ms),
      bayer4ToBayer8ColdMaxStallMs: ms(cold.maxStallMs),
      bayerToggleWarmMs: summary(warm),
      palette256ChangeMs: ms(palette.ms),
      palette256MaxMainThreadStallMs: ms(palette.maxStallMs),
      lutBuild256: {workerMs: ms(workerMs), mainThreadMs: ms(mainMs)},
    });
    if (await perfGate()) {
      expect(cold.ms).toBeLessThanOrEqual(REBUILD_BUDGET_MS);
      expect(workerMs).toBeLessThanOrEqual(LUT_BUDGET_MS);
    }
  }, 300_000);
});
