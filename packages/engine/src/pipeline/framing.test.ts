import {describe, expect, it} from 'vitest';
import {computeFraming, type FramingSettings} from './framing';

function settings(
  w: number,
  h: number,
  pivotRowPx: number,
  framing: 'auto' | number = 'auto',
  preset: FramingSettings['camera']['preset'] = 'side',
  outer = {enabled: true, widthPx: 1 as 1 | 2 | 3},
): FramingSettings {
  return {
    resolution: {width: w, height: h},
    camera: {preset, elevationDeg: 50, framing, pivotRowPx},
    outline: {outer},
  };
}
const box = (minX: number, maxX: number, minY: number, maxY: number) => ({
  minX,
  maxX,
  minY,
  maxY,
});

describe('computeFraming', () => {
  it('AC-PIX-008.3: frustum edges are whole multiples of s from the pivot', () => {
    const s = 0.25;
    const a = computeFraming([], settings(64, 64, 2, s));
    expect(a.frustum).toEqual({
      left: -32 * s,
      right: 32 * s,
      bottom: -2 * s,
      top: 62 * s,
    });
    const b = computeFraming([], settings(33, 48, 4, s));
    expect(b.frustum).toEqual({
      left: -16 * s,
      right: 17 * s,
      bottom: -4 * s,
      top: 44 * s,
    });
  });

  it('AC-PIX-008.2: pivot is [floor(W/2), H - 1 - pivotRowPx]', () => {
    expect(computeFraming([], settings(64, 64, 2, 1)).pivotPx).toEqual([
      32, 61,
    ]);
    expect(computeFraming([], settings(33, 48, 4, 1)).pivotPx).toEqual([
      16, 43,
    ]);
  });

  it('AC-PIX-008.3: pivot projects to continuous (W/2, H - pivotRow)', () => {
    const s = 0.5;
    const f = computeFraming([], settings(33, 48, 4, s));
    // continuous x = -left / s, y = top / s
    expect([-f.frustum.left / s, f.frustum.top / s]).toEqual([16, 44]);
  });

  it('AC-PIX-009.1: fixed framing is used verbatim; taller box reaches higher by dH/s px', () => {
    const s = 0.03125;
    const st = settings(64, 64, 2, s);
    const a = computeFraming(
      [{label: 'a', direction: 0, box: box(-0.3, 0.3, 0, 1.0)}],
      st,
    );
    const b = computeFraming(
      [{label: 'a', direction: 0, box: box(-0.3, 0.3, 0, 1.25)}],
      st,
    );
    expect(a.worldPerPx).toBe(s);
    expect(b.worldPerPx).toBe(s);
    expect(a.clipped).toEqual([]);
    expect(Math.round((1.25 - 1.0) / s)).toBe(8);
  });

  it('AC-PIX-009.2: PIX_FRAMING_CLIPPED names clip and direction, sorted, deduped', () => {
    const f = computeFraming(
      [
        {label: 'walk', direction: 1, box: box(-0.1, 0.1, 0, 5)},
        {label: 'idle', direction: 0, box: box(-0.1, 0.1, 0, 0.5)},
        {label: 'walk', direction: 0, box: box(-0.1, 0.1, 0, 5)},
        {label: 'walk', direction: 0, box: box(-0.1, 0.1, 0, 6)},
      ],
      settings(64, 64, 2, 0.03125),
    );
    expect(f.clipped).toEqual([
      {label: 'walk', direction: 0},
      {label: 'walk', direction: 1},
    ]);
  });

  it('REQ-PIX-009: geometry below the pivot row clips', () => {
    const f = computeFraming(
      [{label: 'death', direction: 2, box: box(-0.1, 0.1, -0.5, 1)}],
      settings(64, 64, 2, 0.0625),
    );
    expect(f.clipped).toEqual([{label: 'death', direction: 2}]);
  });

  it('AC-PIX-015.3: auto framing inflates union bounds by outerWidth + 1 px', () => {
    // up: 62 px available, margin 2 -> 60 px for height 3 -> s = 0.05.
    const f = computeFraming(
      [{label: 'a', direction: 0, box: box(-0.5, 0.5, 0, 3)}],
      settings(64, 64, 2, 'auto', 'side', {enabled: true, widthPx: 1}),
    );
    expect(f.worldPerPx).toBeCloseTo(0.05, 12);
    expect(f.clipped).toEqual([]);
    const wide = computeFraming(
      [{label: 'a', direction: 0, box: box(-0.5, 0.5, 0, 3)}],
      settings(64, 64, 2, 'auto', 'side', {enabled: true, widthPx: 3}),
    );
    expect(wide.worldPerPx).toBeCloseTo(3 / 58, 12);
  });

  it('REQ-PIX-007: auto takes the max over the left, right and top ratios', () => {
    // left avail 32-2 = 30; box minX -6 -> 0.2 dominates top (1/60) and right.
    const f = computeFraming(
      [
        {label: 'a', direction: 0, box: box(-6, 1, 0, 1)},
        {label: 'b', direction: 1, box: box(-1, 3, 0, 2)},
      ],
      settings(64, 64, 2),
    );
    expect(f.worldPerPx).toBeCloseTo(0.2, 12);
    expect(f.clipped).toEqual([]);
  });

  it('REQ-PIX-007: elevation follows the preset, or camera.elevationDeg for custom', () => {
    expect(
      computeFraming([], settings(32, 32, 2, 1, 'isometric')).elevationDeg,
    ).toBe(30);
    expect(
      computeFraming([], settings(32, 32, 2, 1, 'three-quarter')).elevationDeg,
    ).toBe(35);
    expect(
      computeFraming([], settings(32, 32, 2, 1, 'side')).elevationDeg,
    ).toBe(0);
    expect(
      computeFraming([], settings(32, 32, 2, 1, 'custom')).elevationDeg,
    ).toBe(50);
  });

  it('REQ-PIX-007: empty bounds in auto mode give a finite scale', () => {
    expect(computeFraming([], settings(64, 64, 2)).worldPerPx).toBe(1);
  });
});
