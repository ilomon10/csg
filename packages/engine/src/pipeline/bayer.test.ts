import {describe, expect, it} from 'vitest';
import {bayerMatrix, bayerThreshold} from './bayer';

describe('bayerMatrix (spec recursion)', () => {
  it('M2 and M4 match the spec literals', () => {
    expect(bayerMatrix(2)).toEqual([
      [0, 2],
      [3, 1],
    ]);
    expect(bayerMatrix(4)).toEqual([
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5],
    ]);
  });
  it('AC-PIX-019: n=2,4,8 are permutations of 0..n²-1', () => {
    for (const n of [2, 4, 8] as const)
      expect(
        bayerMatrix(n)
          .flat()
          .sort((a, b) => a - b),
      ).toEqual(Array.from({length: n * n}, (_, i) => i));
  });
  it('M8 top-left quadrant is 4*M4', () => {
    const m8 = bayerMatrix(8);
    const m4 = bayerMatrix(4);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++)
        expect(m8[y]?.[x]).toBe(4 * (m4[y]?.[x] ?? NaN));
  });
  it('threshold is cell-local (wraps) and centred', () => {
    expect(bayerThreshold(4, 5, 9)).toBe(bayerThreshold(4, 1, 1));
    expect(bayerThreshold(2, 0, 0)).toBe(0.5 / 4 - 0.5);
  });
  it('rejects other sizes', () => {
    expect(() => bayerMatrix(3 as 2)).toThrow();
  });
});
