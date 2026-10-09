/**
 * Palette LUT source of a renderer (M2-19; spec 003 REQ-PIX-021,
 * AC-PIX-021.2): builds LUTs in the palette LUT worker when one is available
 * (main thread only when no factory was injected), and keeps the last few in a small cache so a palette
 * prepared ahead of a settings change ({@link PaletteLutSource.warm}) and the
 * export's palette switch and restore cost no rebuild. The LUT bytes do not
 * depend on where they were built (AC-PIX-021.5), so neither the worker nor the
 * cache changes output.
 */
import type {HexColor} from '@csg/parts-schema';
import {buildPaletteLut} from './palette-lut';
import type {PaletteLutWorker, PaletteMetric} from './palette-lut';

/** Cached LUTs kept per renderer (1 MiB each). */
export const PALETTE_LUT_CACHE_SIZE = 4;

/** Builds or returns a cached LUT; the pipeline's `PaletteLutBuilder`. */
export type PaletteLutBuild = (
  colors: readonly HexColor[],
  metric: PaletteMetric,
) => Uint8Array | Promise<Uint8Array>;

/** Which path built a LUT (AC-GEN-014.4: e2e asserts the worker path was used). */
export type PaletteLutBuildPath = 'worker' | 'main-thread' | 'failure';

/** Counters of {@link PaletteLutSource.stats}. */
export interface PaletteLutSourceStats {
  /** LUTs built by the worker. */
  readonly workerBuilds: number;
  /** LUTs built on the main thread; only happens when no worker factory was injected. */
  readonly mainThreadBuilds: number;
  /** Worker builds that failed (invalid input, timeout, `error`, `messageerror`, factory error). */
  readonly failures: number;
}

/** A renderer's LUT builder with worker and cache. */
export interface PaletteLutSource {
  /**
   * The LUT for `colors`: synchronously when cached, else from the worker
   * (or the main thread when no factory was injected). Rejects when the worker fails. The returned array is shared with the
   * cache and must not be modified.
   */
  readonly build: PaletteLutBuild;
  /** Builds `colors` into the cache without blocking the main thread. */
  warm(colors: readonly HexColor[], metric: PaletteMetric): Promise<void>;
  /** Whether the next {@link build} of `colors` is a cache hit. */
  has(colors: readonly HexColor[], metric: PaletteMetric): boolean;
  /** Counts of the paths that built LUTs so far (cache hits are not counted). */
  readonly stats: PaletteLutSourceStats;
  /** Terminates the worker; later builds run on the main thread. Idempotent. */
  dispose(): void;
}

/** Options of {@link createPaletteLutSource}. */
export interface PaletteLutSourceOptions {
  /**
   * Starts the worker on the first cache miss, from the host (REQ-GEN-014: the engine never
   * constructs a `Worker` from a URL itself). Absent or `null`: build on the main thread without
   * trying a worker. With a factory, a failing build rejects (REQ-GEN-016): there is no silent
   * main-thread fallback.
   */
  readonly createWorker?: (() => PaletteLutWorker) | null;
  /** Called after each non-cached build with the path that produced it. */
  readonly onBuild?: (path: PaletteLutBuildPath) => void;
}

const keyOf = (colors: readonly HexColor[], metric: PaletteMetric): string =>
  `${metric}:${colors.join(',')}`;

/**
 * Creates a {@link PaletteLutSource}. A failing worker (CSP, load error, timeout) rejects
 * the build and is replaced on the next one; the caller keeps its previous LUT
 * (REQ-GEN-016).
 *
 * @param options Worker factory.
 * @returns The source.
 */
export function createPaletteLutSource(
  options: PaletteLutSourceOptions = {},
): PaletteLutSource {
  const factory = options.createWorker ?? null;
  const stats = {workerBuilds: 0, mainThreadBuilds: 0, failures: 0};
  const record = (path: PaletteLutBuildPath): void => {
    if (path === 'worker') stats.workerBuilds++;
    else if (path === 'main-thread') stats.mainThreadBuilds++;
    else stats.failures++;
    options.onBuild?.(path);
  };
  let worker: PaletteLutWorker | null = null;
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

  /** Drops a failed worker; the next build starts a fresh one from the factory. */
  const dropWorker = (): void => {
    worker?.dispose();
    worker = null;
  };

  const build: PaletteLutBuild = (colors, metric) => {
    const key = keyOf(colors, metric);
    const hit = cache.get(key);
    if (hit !== undefined) return remember(key, hit);
    const pending = inflight.get(key);
    if (pending !== undefined) return pending;
    if (factory === null) {
      const lut = buildPaletteLut(colors, metric);
      record('main-thread');
      return remember(key, lut);
    }
    let promise: Promise<Uint8Array>;
    try {
      worker ??= factory();
      const w = worker;
      promise = w
        .build(colors, metric)
        .then(lut => {
          record('worker');
          return remember(key, lut);
        })
        .catch((e: unknown) => {
          if (worker === w) dropWorker();
          record('failure');
          throw e;
        });
    } catch (e) {
      record('failure');
      return Promise.reject(e);
    }
    promise = promise.finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  };

  return {
    stats,
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
