/**
 * `pnpm assets:thumbnails` renderer (spec 011 REQ-AST-015, REQ-AST-039). Runs only through
 * `vitest.thumbnails.config.ts` (WebGL2, `forceWebGL`), normally inside the canonical container
 * (`scripts/golden-env/run.sh assets:thumbnails:render`). Reads the plan of
 * `tools/thumbnails.ts`, renders every job and hands each WebP plus its RGBA to Node.
 */
import {commands} from 'vitest/browser';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {SUPPORTED_STYLE_COMBOS} from '../../../src/catalog/supported-style-combos';
import {createGpuHarness, nodeEnv, toBase64} from '../harness';
import type {GpuHarness} from '../harness';
import type {ThumbnailOutputPayload} from './thumbnail-commands';
import {
  createThumbnailRig,
  encodeWebp,
  renderJob,
  sharedScales,
  thumbnailRgba,
} from './thumbnail-render';
import type {RenderJob, ThumbnailRig} from './thumbnail-render';

declare module 'vitest/browser' {
  interface BrowserCommands {
    csgThumbnailJobs(): Promise<{
      shapeStyles: string[];
      jobs: RenderJob[];
    }>;
    csgThumbnailOutput(payload: ThumbnailOutputPayload): Promise<void>;
    csgThumbnailReport(json: unknown): Promise<void>;
  }
}

describe('assets:thumbnails (WebGL2)', () => {
  let h: GpuHarness;
  let rig: ThumbnailRig;
  beforeAll(async () => {
    h = await createGpuHarness(64, 64);
    rig = await createThumbnailRig(h);
  });
  afterAll(() => {
    rig?.dispose();
    h?.dispose();
  });

  it('AC-AST-015.1, AC-AST-039.3: renders every planned thumbnail as lossless WebP', async () => {
    expect(h.backend).toBe('webgl2');
    const plan = await commands.csgThumbnailJobs();
    // The planner's shape styles mirror the engine's supported (style, human) pairs.
    const supported = SUPPORTED_STYLE_COMBOS.filter(
      ([, species]) => species === 'human',
    )
      .map(([style]) => style)
      .sort();
    expect([...plan.shapeStyles].sort()).toEqual(supported);

    const shared = await sharedScales(rig, plan.jobs);
    const report: Record<string, unknown> = {
      environment: h.environment,
      canonical: (await nodeEnv()).canonical,
      sharedScales: Object.fromEntries(shared),
      jobs: {},
    };
    for (const job of plan.jobs) {
      const {pixels, worldPerPx} = await renderJob(rig, job, shared);
      const side = job.cellPx * job.scale;
      const rgba = thumbnailRgba(pixels, job.cellPx, job.scale);
      let opaque = 0;
      for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 0) opaque++;
      expect(opaque, `${job.packId}/${job.path} is empty`).toBeGreaterThan(0);
      const webp = await encodeWebp(rgba, side);
      await commands.csgThumbnailOutput({
        packId: job.packId,
        path: job.path,
        webpBase64: toBase64(webp),
        rgbaBase64: toBase64(new Uint8Array(rgba.buffer)),
        width: side,
        height: side,
      });
      (report['jobs'] as Record<string, unknown>)[`${job.packId}/${job.path}`] =
        {worldPerPx, bytes: webp.length, opaque};
    }
    await commands.csgThumbnailReport(report);
  });
});
