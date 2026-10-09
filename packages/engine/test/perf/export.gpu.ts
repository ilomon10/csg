/**
 * Export performance (M2-19): the P-07 case, 64 px, 8 directions, 4 clips, 8 frames (256
 * frames), end to end through the character renderer (`prepareFrames` + consuming
 * `renderFrames`, readback included) on the perf character (8 equipped parts).
 *
 * - AC-PIX-033.1: consuming `renderFrames` produces all 256 frames in <= 5.1 s.
 * - AC-PIX-007.2: the union-bounds pass (`prepareFrames`) adds <= 15 % to the total render time.
 * - P-07 export budget: prepare + render <= 10 s (the encoder budget is spec 005, M3).
 *
 * Two runs: `cold` (first export, includes shader compilation) and `warm` (same renderer again);
 * the budgets are checked on the warm run and both are reported. The warm run's frames must equal
 * the cold run's byte for byte (P-04: performance work must not change output).
 */
import {defaultRenderSettings} from '@csg/parts-schema';
import {afterEach, describe, expect, it} from 'vitest';
import type {RenderedFrame, RenderSettings} from '../../src/contracts/pipeline';
import {
  PERF_CLIPS,
  createPerfRenderer,
  equippedPartCount,
  ms,
  perfCharacter,
  perfGate,
  reportEnvironment,
  resetTimers,
  summary,
  writePerfReport,
} from './perf-harness';
import type {PerfRenderer} from './perf-harness';

const FRAMES = 8;
const EXPORT_BUDGET_MS = 10_000;
const RENDER_BUDGET_MS = 5_100;
const PREPARE_SHARE_BUDGET = 0.15;

function exportSettings(): RenderSettings {
  const s = defaultRenderSettings('three-quarter');
  return {
    ...s,
    resolution: {width: 64, height: 64},
    directions: 8,
    mirrorWest: false,
    animations: PERF_CLIPS.map(clipId => ({
      clipId,
      label: clipId.slice(clipId.lastIndexOf('/') + 1),
      frameCount: FRAMES,
      fps: 8,
      loop: true,
    })),
  };
}

interface RunResult {
  prepareMs: number;
  renderFramesMs: number;
  totalMs: number;
  frames: RenderedFrame[];
  pipelineRenderMs: number;
  readbackMs: number;
  readbackPerFrame: ReturnType<typeof summary>;
}

async function runOnce(p: PerfRenderer): Promise<RunResult> {
  const r = p.renderer;
  resetTimers(p.timers);
  const t0 = performance.now();
  const prepared = await r.prepareFrames(exportSettings());
  const t1 = performance.now();
  if (!prepared.ok) throw new Error(prepared.error.message);
  const readSamples: number[] = [];
  const frames: RenderedFrame[] = [];
  resetTimers(p.timers);
  let lastRead = 0;
  for await (const frame of r.renderFrames(prepared.value)) {
    frames.push(frame);
    readSamples.push(p.timers.readMs - lastRead);
    lastRead = p.timers.readMs;
  }
  const t2 = performance.now();
  return {
    prepareMs: t1 - t0,
    renderFramesMs: t2 - t1,
    totalMs: t2 - t0,
    frames,
    pipelineRenderMs: p.timers.renderMs,
    readbackMs: p.timers.readMs,
    readbackPerFrame: summary(readSamples),
  };
}

function reportRun(run: RunResult): Record<string, unknown> {
  return {
    frames: run.frames.length,
    prepareMs: ms(run.prepareMs),
    renderFramesMs: ms(run.renderFramesMs),
    totalMs: ms(run.totalMs),
    perFrameMs: ms(run.renderFramesMs / Math.max(1, run.frames.length)),
    prepareShare: +(run.prepareMs / run.totalMs).toFixed(3),
    pipelineRenderCpuMs: ms(run.pipelineRenderMs),
    readbackMs: ms(run.readbackMs),
    readbackShareOfRender: +(run.readbackMs / run.renderFramesMs).toFixed(3),
    readbackPerFrame: run.readbackPerFrame,
  };
}

let live: PerfRenderer | undefined;
afterEach(() => {
  live?.dispose();
  live = undefined;
});

describe('export performance (M2-19)', () => {
  it('AC-PIX-033.1, AC-PIX-007.2, P-07: 64 px x 8 directions x 4 clips x 8 frames end to end', async () => {
    live = await createPerfRenderer({settings: exportSettings()});
    expect(equippedPartCount(perfCharacter())).toBe(8);
    const cold = await runOnce(live);
    const warm = await runOnce(live);
    expect(cold.frames.length).toBe(4 * 8 * FRAMES);
    expect(warm.frames.length).toBe(cold.frames.length);
    // Determinism: the second export is byte-identical (P-04).
    for (let i = 0; i < warm.frames.length; i++) {
      const a = cold.frames[i]?.pixels;
      const b = warm.frames[i]?.pixels;
      expect(a !== undefined && b !== undefined).toBe(true);
      if (a === undefined || b === undefined) continue;
      expect(
        a.length === b.length && a.every((v, k) => v === b[k]),
        `frame ${i}`,
      ).toBe(true);
    }
    const report = {
      ac: ['AC-PIX-033.1', 'AC-PIX-007.2', 'P-07 export'],
      ...(await reportEnvironment(live.renderer.renderer)),
      case: '64 px, 8 directions, 4 clips (idle, walk, jog, sword-attack), 8 frames, perf character (8 parts)',
      budgets: {
        renderFramesMs: RENDER_BUDGET_MS,
        prepareShare: PREPARE_SHARE_BUDGET,
        exportMs: EXPORT_BUDGET_MS,
      },
      cold: reportRun(cold),
      warm: reportRun(warm),
    };
    await writePerfReport('export-p07', report);
    if (await perfGate()) {
      expect(warm.renderFramesMs).toBeLessThanOrEqual(RENDER_BUDGET_MS);
      expect(warm.prepareMs / warm.totalMs).toBeLessThanOrEqual(
        PREPARE_SHARE_BUDGET,
      );
      expect(warm.totalMs).toBeLessThanOrEqual(EXPORT_BUDGET_MS);
    }
  }, 600_000);
});
