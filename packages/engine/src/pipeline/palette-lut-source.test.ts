import {PALETTE_PRESETS} from '@csg/parts-schema';
import {describe, expect, it, vi} from 'vitest';
import {buildPaletteLut, createPaletteLutWorker} from './palette-lut';
import type {PaletteLutWorker} from './palette-lut';
import {
  PALETTE_LUT_CACHE_SIZE,
  createPaletteLutSource,
} from './palette-lut-source';

const PICO = [...PALETTE_PRESETS['pico-8'].colors];

/** A worker that builds on the main thread asynchronously, counting builds. */
function fakeWorker(fail = false) {
  const stats = {builds: 0, disposed: 0};
  const worker: PaletteLutWorker = {
    build: async (colors, metric) => {
      stats.builds++;
      await Promise.resolve();
      if (fail) throw new Error('worker failed');
      return buildPaletteLut(colors, metric);
    },
    dispose: () => {
      stats.disposed++;
    },
  };
  return {worker, stats};
}

describe('palette LUT source (M2-19)', () => {
  it('AC-PIX-021.2: builds in the worker, same bytes as the main thread, then serves the cache synchronously', async () => {
    const {worker, stats} = fakeWorker();
    const source = createPaletteLutSource({createWorker: () => worker});
    expect(source.has(PICO, 'oklab')).toBe(false);
    const first = source.build(PICO, 'oklab');
    expect(first).toBeInstanceOf(Promise);
    expect(Array.from(await first)).toEqual(
      Array.from(buildPaletteLut(PICO, 'oklab')),
    );
    expect(source.has(PICO, 'oklab')).toBe(true);
    const hit = source.build(PICO, 'oklab');
    expect(hit).toBeInstanceOf(Uint8Array);
    expect(stats.builds).toBe(1);
    source.dispose();
    expect(stats.disposed).toBe(1);
  });

  it('AC-PIX-021.2: concurrent requests share one build; the cache keeps the most recent palettes', async () => {
    const {worker, stats} = fakeWorker();
    const source = createPaletteLutSource({createWorker: () => worker});
    await Promise.all([source.warm(PICO, 'oklab'), source.warm(PICO, 'oklab')]);
    expect(stats.builds).toBe(1);
    for (let i = 0; i < PALETTE_LUT_CACHE_SIZE; i++)
      await source.warm([`#0000${(i + 16).toString(16)}`], 'oklab');
    expect(source.has(PICO, 'oklab')).toBe(false);
    expect(source.has(['#000013'], 'oklab')).toBe(true);
    expect(source.has(['#000013'], 'srgb')).toBe(false);
  });

  it('AC-GEN-016.2: a failing worker rejects the build, nothing is cached and there is no main-thread fallback', async () => {
    const {worker, stats} = fakeWorker(true);
    const source = createPaletteLutSource({createWorker: () => worker});
    await expect(source.build(PICO, 'srgb')).rejects.toThrow(/worker failed/);
    expect(source.has(PICO, 'srgb')).toBe(false);
    expect(stats.disposed).toBe(1);
    expect(source.stats).toEqual({
      workerBuilds: 0,
      mainThreadBuilds: 0,
      failures: 1,
    });
  });

  it('AC-PIX-021.2: without a worker factory (Node, or null) builds synchronously; a throwing factory rejects', async () => {
    expect(createPaletteLutSource().build(PICO, 'oklab')).toBeInstanceOf(
      Uint8Array,
    );
    let threw = false;
    const source = createPaletteLutSource({
      createWorker: () => {
        threw = true;
        throw new Error('blocked by CSP');
      },
    });
    await expect(source.build(PICO, 'oklab')).rejects.toThrow(/CSP/);
    expect(threw).toBe(true);
    expect(source.stats.mainThreadBuilds).toBe(0);
    expect(source.stats.failures).toBe(1);
  });

  it('AC-GEN-014.4: stats and onBuild report which path built each LUT', async () => {
    const paths: string[] = [];
    const {worker} = fakeWorker();
    const viaWorker = createPaletteLutSource({
      createWorker: () => worker,
      onBuild: p => paths.push(p),
    });
    await viaWorker.build(PICO, 'oklab');
    void viaWorker.build(PICO, 'oklab'); // cache hit: not counted
    expect(viaWorker.stats).toEqual({
      workerBuilds: 1,
      mainThreadBuilds: 0,
      failures: 0,
    });
    const failing = fakeWorker(true);
    const fallback = createPaletteLutSource({
      createWorker: () => failing.worker,
      onBuild: p => paths.push(p),
    });
    await expect(fallback.build(PICO, 'srgb')).rejects.toThrow();
    expect(fallback.stats.failures).toBe(1);
    const main = createPaletteLutSource({onBuild: p => paths.push(p)});
    void main.build(PICO, 'oklab');
    expect(main.stats.mainThreadBuilds).toBe(1);
    expect(paths).toEqual(['worker', 'failure', 'main-thread']);
  });

  it('AC-GEN-014.4: without a factory no worker is attempted, even when Worker exists', () => {
    const original = (globalThis as {Worker?: unknown}).Worker;
    const ctor = vi.fn();
    (globalThis as {Worker?: unknown}).Worker = ctor;
    try {
      const source = createPaletteLutSource();
      void source.build(PICO, 'oklab');
      expect(ctor).not.toHaveBeenCalled();
      expect(source.stats.workerBuilds).toBe(0);
    } finally {
      (globalThis as {Worker?: unknown}).Worker = original;
    }
  });

  it('AC-GEN-016.2: a timed-out worker rejects the build, is counted, and the next build starts a fresh worker', async () => {
    vi.useFakeTimers();
    try {
      const fake = new EventTarget() as EventTarget & {
        postMessage(): void;
        terminate(): void;
      };
      fake.postMessage = () => {};
      fake.terminate = () => {};
      let created = 0;
      const source = createPaletteLutSource({
        createWorker: () => {
          created++;
          return createPaletteLutWorker({
            createWorker: () => fake as unknown as Worker,
            timeoutMs: 500,
          });
        },
      });
      const p = source.build(PICO, 'oklab');
      const assertion = expect(p).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(500);
      await assertion;
      expect(source.stats.failures).toBe(1);
      expect(source.stats.mainThreadBuilds).toBe(0);
      expect(source.has(PICO, 'oklab')).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      const again = source.build(PICO, 'oklab');
      const assertion2 = expect(again).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(500);
      await assertion2;
      expect(created).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
