import {describe, expect, it} from 'vitest';
import {normalizeReadback} from './readback';

const W = 48;
const H = 40;

/** Pixel (x,y) top-left coordinates encode into RGBA. */
function expected(): Uint8ClampedArray {
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) out.set([x, y, 7, 255], (y * W + x) * 4);
  out[0] = 200; // marker, top-left
  return out;
}

describe('AC-PIX-029.1: normalizeReadback', () => {
  it('WebGPU: 256-byte padded top-first rows, buffer ends at (H-1)*stride + W*4', () => {
    const stride = Math.ceil((W * 4) / 256) * 256;
    expect(stride).toBe(256);
    const want = expected();
    const raw = new Uint8Array((H - 1) * stride + W * 4).fill(0xaa);
    for (let y = 0; y < H; y++)
      raw.set(want.subarray(y * W * 4, (y + 1) * W * 4), y * stride);
    const got = normalizeReadback(raw, W, H, {
      rowStrideBytes: stride,
      bottomUp: false,
    });
    expect(got.length).toBe(W * H * 4);
    expect(got[0]).toBe(200);
    expect(got).toEqual(want);
  });
  it('WebGL2: tight bottom-first rows are flipped to top-left', () => {
    const want = expected();
    const raw = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++)
      raw.set(want.subarray(y * W * 4, (y + 1) * W * 4), (H - 1 - y) * W * 4);
    const got = normalizeReadback(raw, W, H, {
      rowStrideBytes: W * 4,
      bottomUp: true,
    });
    expect(got[0]).toBe(200);
    expect(got).toEqual(want);
  });
  it('honours byteOffset of a view', () => {
    const want = expected();
    const backing = new Uint8Array(16 + W * H * 4);
    backing.set(want, 16);
    const view = new Uint8Array(backing.buffer, 16);
    expect(
      normalizeReadback(view, W, H, {rowStrideBytes: W * 4, bottomUp: false}),
    ).toEqual(want);
  });
  it('rejects short buffers and small strides', () => {
    expect(() =>
      normalizeReadback(new Uint8Array(10), W, H, {
        rowStrideBytes: W * 4,
        bottomUp: false,
      }),
    ).toThrow();
    expect(() =>
      normalizeReadback(new Uint8Array(W * H * 4), W, H, {
        rowStrideBytes: 4,
        bottomUp: false,
      }),
    ).toThrow();
  });
  // GPU test: M2-08 harness - 48x40 marker on both backends.
});
