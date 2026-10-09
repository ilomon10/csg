/**
 * Palette LUT source of a renderer (M2-19; spec 003 REQ-PIX-021,
 * AC-PIX-021.2): builds LUTs in the palette LUT worker when one is available
 * (main-thread fallback), and keeps the last few in a small cache so a palette
 * prepared ahead of a settings change ({@link PaletteLutSource.warm}) and the
 * export's palette switch and restore cost no rebuild. The LUT bytes do not
 * depend on where they were built (AC-PIX-021.5), so neither the worker nor the
 * cache changes output.
 */
import type {HexColor} from '@csg/parts-schema';
import {buildPaletteLut, createPaletteLutWorker} from './palette-lut';
import type {PaletteLutWorker, PaletteMetric} from './palette-lut';

/** Cached LUTs kept per renderer (1 MiB each). */
export const PALETTE_LUT_CACHE_SIZE = 4;

/** Builds or returns a cached LUT; the pipeline's `PaletteLutBuilder`. */
export type PaletteLutBuild = (
  colors: readonly HexColor[],
  metric: PaletteMetric,
) => Uint8Array | Promise<Uint8Array>;

/** A renderer's LUT builder with worker, fallback and cache. */
export interface PaletteLutSource {
  /**
   * The LUT for `colors`: synchronously when cached, else from the worker
   * (or the main thread without one). The returned array is shared with the
   * cache and must not be modified.
   */
  readonly build: PaletteLutBuild;
  /** Builds `colors` into the cache without blocking the main thread. */
  warm(colors: readonly HexColor[], metric: PaletteMetric): Promise<void>;
  /** Whether the next {@link build} of `colors` is a cache hit. */
  has(colors: readonly HexColor[], metric: PaletteMetric): boolean;
  /** Terminates the worker; later builds run on the main thread. Idempotent. */
  dispose(): void;
}

/** Options of {@link createPaletteLutSource}. */
export interface PaletteLutSourceOptions {
  /**
   * Starts the worker on the first cache miss. `null` = build on the main
   * thread. Default: the bundled module worker when `Worker` exists.
   */
  readonly createWorker?: (() => PaletteLutWorker) | null;
}

const keyOf = (colors: readonly HexColor[], metric: PaletteMetric): string =>
  `${metric}:${colors.join(',')}`;

/**
 * Creates a {@link PaletteLutSource}. A worker that fails (CSP, load error)
 * is dropped and the build falls back to the main thread, so a LUT is always
 * produced.
 *
 * @param options Worker factory.
 * @returns The source.
 */
export function createPaletteLutSource(
  options: PaletteLutSourceOptions = {},
): PaletteLutSource {
  const factory =
    options.createWorker !== undefined
      ? options.createWorker
      : typeof Worker === 'undefined'
        ? null
        : () => createPaletteLutWorker();
  let worker: PaletteLutWorker | null = null;
  let workerFailed = factory === null;
  let disposed = false;
  /** Insertion-ordered: the first key is the least recently used. */
  const cache = new Map<string, Uint8Array>();
  const inflight = new Map<string, Promise<Uint8Array>>();

  const remember = (key: string, lut: Uint8Array): Uint8Array => {
    cache.delete(key);
    cache.set(key, lut);
    while (cache.size > PALETTE_LUT_CACHE_SIZE) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return lut;
  };

  const dropWorker = (): void => {
    workerFailed = true;
    worker?.dispose();
    worker = null;
  };

  const workerFor = (): PaletteLutWorker | null => {
    if (workerFailed || disposed || factory === null) return null;
    if (worker === null) {
      try {
        worker = factory();
      } catch {
        dropWorker();
      }
    }
    return worker;
  };

  const build: PaletteLutBuild = (colors, metric) => {
    const key = keyOf(colors, metric);
    const hit = cache.get(key);
    if (hit !== undefined) return remember(key, hit);
    const pending = inflight.get(key);
    if (pending !== undefined) return pending;
    const w = workerFor();
    if (w === null) return remember(key, buildPaletteLut(colors, metric));
    const promise = w
      .build(colors, metric)
      .catch(() => {
        // Invalid input fails the same way on the main thread (and throws
        // there); a broken worker is dropped for good.
        if (!disposed) dropWorker();
        return buildPaletteLut(colors, metric);
      })
      .then(lut => remember(key, lut))
      .finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  };

  return {
    build,
    async warm(colors, metric) {
      await build(colors, metric);
    },
    has(colors, metric) {
      return cache.has(keyOf(colors, metric));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      worker?.dispose();
      worker = null;
      cache.clear();
    },
  };
}
