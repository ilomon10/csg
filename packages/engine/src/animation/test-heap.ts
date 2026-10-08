/**
 * Test-only helper for the "allocates nothing per frame" checks (REQ-ANM-008):
 * measures average heap growth per call over many iterations after a warm-up,
 * so a stray allocation elsewhere in the worker does not make the test flaky.
 * Never imported by runtime code.
 */

/** Allowed average growth per call when `global.gc` is available (bytes). */
export const STRICT_BYTES_PER_CALL = 8;

/**
 * Allowed average growth per call without `global.gc` (bytes). Without a forced
 * collection the starting heap holds garbage of earlier tests, so the bound is
 * loose; it still catches a per-call `Map` entry or array.
 */
export const LOOSE_BYTES_PER_CALL = 64;

/**
 * Bound for paths that sample clips through three's `Interpolant`s (bytes per
 * call). Measured on the fixture (2026-10-09): `seek` shows ~30-80 B per call
 * even for a constant time, from V8 boxing doubles (16 B HeapNumbers) inside
 * three's interpolants, which this code cannot avoid. A real per-frame object
 * allocation in our code is per bone (22 fixture bones x >= 32 B > 700 B), so
 * this bound still catches it.
 */
export const INTERPOLANT_BYTES_PER_CALL = 256;

/**
 * Average heap growth per call of `run`.
 *
 * @param run - The per-frame call; receives the iteration index.
 * @param iterations - Measured calls (default 200k).
 * @param warmup - Unmeasured calls first (JIT, caches; default 5k).
 * @param bound - Bound override (for example {@link INTERPOLANT_BYTES_PER_CALL});
 *   default strict with `gc`, loose without.
 * @returns Bytes per call and the bound that applies.
 */
export function heapGrowthPerCall(
  run: (i: number) => void,
  iterations = 200_000,
  warmup = 5_000,
  bound?: number,
): {readonly bytesPerCall: number; readonly limit: number} {
  for (let i = 0; i < warmup; i++) run(i);
  const gc = (globalThis as {gc?: () => void}).gc;
  gc?.();
  const heap = (): number =>
    (process as unknown as {memoryUsage(): {heapUsed: number}}).memoryUsage()
      .heapUsed;
  const before = heap();
  for (let i = 0; i < iterations; i++) run(i);
  const growth = Math.max(0, heap() - before);
  return {
    bytesPerCall: growth / iterations,
    limit:
      bound ??
      (gc === undefined ? LOOSE_BYTES_PER_CALL : STRICT_BYTES_PER_CALL),
  };
}
