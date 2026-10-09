import {describe, expect, it} from 'vitest';
import {AVATAR_PX, composeStrip, cropAvatar, frameIndexAt} from './avatar-crop';
import type {PixelFrame} from './avatar-crop';

function blank(w = 64, h = 64): PixelFrame {
  return {width: w, height: h, pixels: new Uint8ClampedArray(w * h * 4)};
}

function paint(
  f: PixelFrame,
  x: number,
  y: number,
  rgba: [number, number, number, number],
): void {
  f.pixels.set(rgba, (y * f.width + x) * 4);
}

describe('home frame avatar (decision D5)', () => {
  it('REQ-UX-080: crops 32x32 from the first opaque row, centred on the opaque columns, doubled to 64x64', () => {
    const f = blank();
    // Opaque columns 20..39 (centre 29), first opaque row 10.
    paint(f, 20, 10, [255, 0, 0, 255]);
    paint(f, 39, 40, [0, 255, 0, 255]);
    const avatar = cropAvatar(f);
    expect(avatar).toHaveLength(AVATAR_PX * AVATAR_PX * 4);
    // Crop x0 = 29 - 16 = 13, y0 = 10. Source (20,10) lands at crop (7,0) -> 2x2 block at (14,0).
    for (const [x, y] of [
      [14, 0],
      [15, 0],
      [14, 1],
      [15, 1],
    ] as const) {
      expect(
        Array.from(avatar.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)),
      ).toEqual([255, 0, 0, 255]);
    }
    // Row 40 is inside the crop (rows 10..41).
    const gx = (39 - 13) * 2;
    const gy = (40 - 10) * 2;
    expect(avatar[(gy * 64 + gx) * 4 + 1]).toBe(255);
    // Everything else stays transparent.
    expect(avatar[(30 * 64 + 2) * 4 + 3]).toBe(0);
  });

  it('REQ-UX-080: an empty frame gives a transparent avatar and the crop is deterministic', () => {
    expect(cropAvatar(blank()).every(v => v === 0)).toBe(true);
    const f = blank();
    paint(f, 30, 5, [1, 2, 3, 255]);
    expect(cropAvatar(f)).toEqual(cropAvatar(f));
  });

  it('REQ-UX-082: the strip is (64 x frameCount) x 64 with frames side by side', () => {
    const a = blank();
    const b = blank();
    paint(a, 0, 0, [9, 9, 9, 255]);
    paint(b, 0, 0, [7, 7, 7, 255]);
    const strip = composeStrip([a, b]);
    expect([strip.width, strip.height]).toEqual([128, 64]);
    expect(strip.pixels[0]).toBe(9);
    expect(strip.pixels[64 * 4]).toBe(7);
  });

  it('AC-UX-084.1: reduced motion shows still frame 0; otherwise the frame follows fps', () => {
    expect(frameIndexAt(8, 5, 5000, true)).toBe(0);
    expect(frameIndexAt(8, 5, 0, false)).toBe(0);
    expect(frameIndexAt(8, 5, 400, false)).toBe(2);
    expect(frameIndexAt(8, 5, 1600, false)).toBe(0);
  });
});
