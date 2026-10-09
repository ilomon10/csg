import {PALETTE_PRESETS} from '@csg/parts-schema';
import {describe, expect, it} from 'vitest';
import {buildPaletteLut} from './palette-lut';
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

  it('AC-PIX-021.2: a failing worker is dropped and the LUT is built on the main thread', async () => {
    const {worker, stats} = fakeWorker(true);
    const source = createPaletteLutSource({createWorker: () => worker});
    const lut = await source.build(PICO, 'srgb');
    expect(Array.from(lut)).toEqual(Array.from(buildPaletteLut(PICO, 'srgb')));
    expect(stats.disposed).toBe(1);
    // Later builds skip the worker and return synchronously.
    expect(source.build(['#ffffff'], 'oklab')).toBeInstanceOf(Uint8Array);
    expect(stats.builds).toBe(1);
  });

  it('AC-PIX-021.2: without a worker (Node, or null) builds synchronously', () => {
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
    expect(source.build(PICO, 'oklab')).toBeInstanceOf(Uint8Array);
    expect(threw).toBe(true);
  });
});
