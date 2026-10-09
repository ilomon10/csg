/**
 * Bayer ordered-dither index matrices (spec 003 Data & contracts, REQ-PIX-019).
 * Pure CPU oracle for the GPU stage; integer math only.
 */

/** Supported matrix sizes. */
export type BayerSize = 2 | 4 | 8;

/**
 * Bayer index matrix by the spec recursion: `M2 = [[0,2],[3,1]]`,
 * `M(2n) = [[4M, 4M+2], [4M+3, 4M+1]]`, indexed `[y][x]`. Values are a
 * permutation of `0..n*n-1`. Anchored to cell-local coordinates: callers
 * index with `x % n`, `y % n` of the cell pixel, never frame coordinates.
 *
 * @param n Matrix size, 2, 4 or 8.
 * @returns A fresh `n` by `n` matrix.
 * @throws Error when `n` is not 2, 4 or 8 (programmer error).
 */
export function bayerMatrix(n: BayerSize): number[][] {
  if (n !== 2 && n !== 4 && n !== 8)
    throw new Error(`bayerMatrix: size ${n} is not 2, 4 or 8`);
  // Flat row-major build; flat indexing keeps strict index checks quiet.
  let size = 2;
  let flat = [0, 2, 3, 1];
  while (size < n) {
    const h = size;
    size = 2 * h;
    const next = new Array<number>(size * size).fill(0);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < h; x++) {
        const v = 4 * (flat[y * h + x] ?? 0);
        next[y * size + x] = v;
        next[y * size + x + h] = v + 2;
        next[(y + h) * size + x] = v + 3;
        next[(y + h) * size + x + h] = v + 1;
      }
    }
    flat = next;
  }
  const rows: number[][] = [];
  for (let y = 0; y < n; y++) rows.push(flat.slice(y * n, (y + 1) * n));
  return rows;
}

/**
 * Threshold in `[-0.5, 0.5)` for a cell-local pixel: `(M + 0.5) / n² - 0.5`.
 *
 * @param n Matrix size.
 * @param x Cell-local x (any integer; wrapped by `n`).
 * @param y Cell-local y.
 * @returns The centred threshold.
 */
export function bayerThreshold(n: BayerSize, x: number, y: number): number {
  const v = bayerMatrix(n)[((y % n) + n) % n]?.[((x % n) + n) % n] ?? 0;
  return (v + 0.5) / (n * n) - 0.5;
}
