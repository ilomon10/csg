import {describe, expect, it} from 'vitest';
import {linearSrgbToOklab, portableCbrt} from './oklab';

describe('REQ-PIX-021: portable OKLab', () => {
  it('AC-PIX-021.4: portableCbrt agrees with Math.cbrt to a few ulps over many decades', () => {
    expect(portableCbrt(0)).toBe(0);
    expect(portableCbrt(1)).toBe(1);
    expect(portableCbrt(8)).toBe(2);
    expect(portableCbrt(0.125)).toBe(0.5);
    expect(portableCbrt(-27)).toBe(-3);
    expect(portableCbrt(Infinity)).toBe(Infinity);
    expect(Number.isNaN(portableCbrt(Number.NaN))).toBe(true);
    for (let e = -300; e <= 300; e += 7) {
      for (const m of [1, 1.37, 2.5, 4.999, 7.77]) {
        const x = m * Math.pow(10, e);
        const rel = Math.abs(portableCbrt(x) - Math.cbrt(x)) / Math.cbrt(x);
        expect(rel).toBeLessThan(1e-15);
      }
    }
    for (let k = 1; k <= 1000; k++) {
      const x = k / 1000;
      expect(Math.abs(portableCbrt(x) - Math.cbrt(x))).toBeLessThan(4e-16);
    }
  });

  it('AC-PIX-017.4: white has L = 1 and a = b = 0, black is 0, and L is monotone on greys', () => {
    const w = linearSrgbToOklab(1, 1, 1);
    expect(w.L).toBeCloseTo(1, 6);
    expect(w.a).toBeCloseTo(0, 6);
    expect(w.b).toBeCloseTo(0, 6);
    expect(linearSrgbToOklab(0, 0, 0)).toEqual({L: 0, a: 0, b: 0});
    let prev = -1;
    for (let k = 0; k <= 64; k++) {
      const {L} = linearSrgbToOklab(k / 64, k / 64, k / 64);
      expect(L).toBeGreaterThan(prev);
      prev = L;
    }
  });

  it('AC-PIX-021.4: matches the published OKLab of sRGB red', () => {
    // Ottosson reference: linear (1, 0, 0) -> (0.627955, 0.224863, 0.125846).
    const red = linearSrgbToOklab(1, 0, 0);
    expect(red.L).toBeCloseTo(0.627955, 5);
    expect(red.a).toBeCloseTo(0.224863, 5);
    expect(red.b).toBeCloseTo(0.125846, 5);
  });

  it('writes into the given output object without allocating', () => {
    const out = {L: 9, a: 9, b: 9};
    expect(linearSrgbToOklab(0.5, 0.2, 0.1, out)).toBe(out);
  });
});
