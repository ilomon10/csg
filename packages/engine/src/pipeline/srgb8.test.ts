import {describe, expect, it} from 'vitest';
import {
  SRGB8_ENCODE_THRESHOLDS,
  SRGB8_TO_LINEAR,
  linearToSrgb8,
  srgb8ToLinear,
} from './srgb8';

// Reference transfer functions (IEC 61966-2-1); the committed tables must match them.
const eotf = (c: number) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const oetf = (v: number) =>
  v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;

describe('REQ-PIX-021: committed sRGB8 tables', () => {
  it('AC-PIX-021.4: SRGB8_TO_LINEAR matches the sRGB EOTF for all 256 codes', () => {
    expect(SRGB8_TO_LINEAR.length).toBe(256);
    expect(SRGB8_TO_LINEAR[0]).toBe(0);
    expect(SRGB8_TO_LINEAR[255]).toBe(1);
    for (let c = 0; c < 256; c++) {
      expect(
        Math.abs((SRGB8_TO_LINEAR[c] as number) - eotf(c / 255)),
      ).toBeLessThan(1e-15);
      if (c > 0) {
        expect(SRGB8_TO_LINEAR[c]).toBeGreaterThan(
          SRGB8_TO_LINEAR[c - 1] as number,
        );
      }
    }
  });

  it('AC-PIX-021.4: encode thresholds are the decoded half-steps, strictly increasing', () => {
    expect(SRGB8_ENCODE_THRESHOLDS.length).toBe(255);
    for (let i = 0; i < 255; i++) {
      const t = SRGB8_ENCODE_THRESHOLDS[i] as number;
      expect(Math.abs(t - eotf((i + 0.5) / 255))).toBeLessThan(1e-15);
      expect(t).toBeGreaterThan(SRGB8_TO_LINEAR[i] as number);
      expect(t).toBeLessThan(SRGB8_TO_LINEAR[i + 1] as number);
    }
  });
});

describe('REQ-PIX-024: sRGB8 conversions', () => {
  it('AC-PIX-021.4: linearToSrgb8 inverts srgb8ToLinear for every code', () => {
    for (let c = 0; c < 256; c++)
      expect(linearToSrgb8(srgb8ToLinear(c))).toBe(c);
  });

  it('AC-PIX-021.4: linearToSrgb8 equals round(OETF(v) · 255) away from half-steps', () => {
    for (let k = 0; k <= 4096; k++) {
      const v = k / 4096;
      const exact = oetf(v) * 255;
      if (Math.abs(exact - Math.floor(exact) - 0.5) < 1e-9) continue;
      expect(linearToSrgb8(v)).toBe(Math.round(exact));
    }
  });

  it('AC-PIX-021.4: clamps out-of-range input and rejects non-byte codes', () => {
    expect(linearToSrgb8(-1)).toBe(0);
    expect(linearToSrgb8(2)).toBe(255);
    expect(linearToSrgb8(Number.NaN)).toBe(0);
    expect(() => srgb8ToLinear(256)).toThrow(RangeError);
    expect(() => srgb8ToLinear(1.5)).toThrow(RangeError);
    expect(() => srgb8ToLinear(-1)).toThrow(RangeError);
  });
});
