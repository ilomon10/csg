/** Readback normalization (REQ-PIX-029). Pure; no GPU access. */
import type {NormalizeReadback} from '../contracts/pipeline';

/**
 * Normalizes a raw render-target readback to tightly packed RGBA8 with a
 * top-left origin. WebGPU rows are padded to 256 bytes and top-first (the
 * buffer may end after the last row's `w * 4` bytes, length
 * `(h-1) * stride + w*4`); WebGL2 rows are tight and bottom-first.
 *
 * @param raw Raw bytes.
 * @param w Width in pixels.
 * @param h Height in pixels.
 * @param layout Row stride and vertical order.
 * @returns A new `w * h * 4` buffer.
 * @throws Error when the stride is below `w * 4` or the buffer is too short.
 */
export const normalizeReadback: NormalizeReadback = (raw, w, h, layout) => {
  const rowBytes = w * 4;
  const stride = layout.rowStrideBytes;
  if (stride < rowBytes)
    throw new Error(`normalizeReadback: stride ${stride} < row ${rowBytes}`);
  const needed = h > 0 ? (h - 1) * stride + rowBytes : 0;
  if (raw.byteLength < needed)
    throw new Error(
      `normalizeReadback: buffer ${raw.byteLength} bytes < required ${needed}`,
    );
  const src = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  const out = new Uint8ClampedArray(rowBytes * h);
  for (let y = 0; y < h; y++) {
    const srcRow = layout.bottomUp ? h - 1 - y : y;
    const start = srcRow * stride;
    out.set(src.subarray(start, start + rowBytes), y * rowBytes);
  }
  return out;
};
