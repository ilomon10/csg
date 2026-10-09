/**
 * Deterministic PNG writer (REQ-EXP-018): 8-bit RGBA, non-interlaced, chunks `IHDR`, `IDAT`,
 * `IEND` only, filter 0 on every row and a fixed zlib level. Deflate comes from `fflate`
 * (MIT, pure JS), because `CompressionStream` cannot fix a level.
 */
import {zlibSync} from 'fflate';

/** Fixed zlib level of every PNG and ZIP entry (REQ-EXP-018). */
export const EXPORT_DEFLATE_LEVEL = 6;

let crcTable: Uint32Array | null = null;

/** CRC-32 (IEEE 802.3) of `bytes`, as used by PNG and ZIP. */
export function crc32(bytes: Uint8Array): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  const table = crcTable;
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (table[(crc ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * Encodes straight-alpha RGBA8 pixels as a PNG.
 *
 * @param rgba Tightly packed pixels, top-left origin, `w * h * 4` bytes.
 * @param w Width in pixels (1..2^31-1).
 * @param h Height in pixels.
 * @returns The PNG bytes; identical input gives identical bytes.
 * @throws Error when the size is invalid or `rgba` has the wrong length.
 */
export function encodePng(
  rgba: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
): Uint8Array {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) {
    throw new Error(`encodePng: invalid size ${w}x${h}`);
  }
  if (rgba.length !== w * h * 4) {
    throw new Error('encodePng: pixel buffer length does not match the size');
  }
  const stride = w * 4;
  const raw = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    // Filter type 0 (None) is already the zero byte at the start of each row.
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, w);
  view.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // compression 0, filter 0, interlace 0
  const idat = zlibSync(raw, {level: EXPORT_DEFLATE_LEVEL});
  const parts = [
    Uint8Array.from(SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ];
  return concatBytes(parts);
}

/** Concatenates byte arrays. */
export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
