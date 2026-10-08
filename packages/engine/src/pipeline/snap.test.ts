import {describe, expect, it} from 'vitest';
import {snapOffsetPx, snapPx, snapToTexel} from './snap';

describe('snap', () => {
  it('AC-PIX-010.3: rounds half away from zero, deterministically', () => {
    expect(snapPx(2.5)).toBe(3);
    expect(snapPx(-2.5)).toBe(-3);
    expect(snapPx(0.5)).toBe(1);
    expect(snapPx(2.4999)).toBe(2);
    expect(snapPx(0.49999999999999994)).toBe(0);
    expect(Object.is(snapPx(-0.2), 0)).toBe(true);
    for (let i = 0; i < 3; i++) expect(snapPx(2.5)).toBe(3);
  });

  it('REQ-PIX-010: snaps world offsets to whole texels', () => {
    expect(snapToTexel(0.37 * 0.25, 0.25)).toBe(0);
    expect(snapToTexel(0.6 * 0.25, 0.25)).toBe(0.25);
    expect(snapOffsetPx([0.625, -0.625], 0.25)).toEqual([3, -3]);
  });
});
