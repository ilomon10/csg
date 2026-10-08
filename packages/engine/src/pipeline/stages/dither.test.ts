import {describe, expect, it} from 'vitest';
import {bayerMatrix} from '../bayer';
import type {BayerSize} from '../bayer';
import {DITHER_SPREAD, bayerIndexBits} from './dither';

describe('Bayer dither (pure)', () => {
  for (const n of [2, 4, 8] as const satisfies readonly BayerSize[]) {
    it(`AC-PIX-022.2: bit formula equals the spec recursion for n=${n} and repeats every n px`, () => {
      const m = bayerMatrix(n);
      for (let y = 0; y < 3 * n; y++) {
        for (let x = 0; x < 3 * n; x++) {
          expect(bayerIndexBits(n, x, y)).toBe(m[y % n]?.[x % n]);
        }
      }
    });
  }

  it('REQ-PIX-022: DITHER_SPREAD is the spec value 0.25', () => {
    expect(DITHER_SPREAD).toBe(0.25);
  });
});
