/** Node helpers of the exporter tests: hashing, PNG and ZIP readers. */
import {unzipSync, unzlibSync} from 'fflate';

interface NodeCrypto {
  createHash(alg: string): {
    update(d: Uint8Array): {digest(enc: 'hex'): string};
  };
}
const crypto = (
  globalThis as unknown as {
    process: {getBuiltinModule(id: string): unknown};
  }
).process.getBuiltinModule('node:crypto') as NodeCrypto;

/** SHA-256 hex of `bytes`. */
export function sha256(bytes: Uint8Array): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/** Hex of `bytes`. */
export function hex(bytes: Uint8Array): string {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** A decoded PNG: chunk types in order, size, RGBA pixels (filter 0 only). */
export function parsePng(bytes: Uint8Array): {
  chunks: string[];
  width: number;
  height: number;
  colorType: number;
  rgba: Uint8Array;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: string[] = [];
  const idat: Uint8Array[] = [];
  let width = 0;
  let height = 0;
  let colorType = -1;
  let o = 8;
  while (o < bytes.length) {
    const len = view.getUint32(o);
    const type = String.fromCharCode(...bytes.subarray(o + 4, o + 8));
    chunks.push(type);
    if (type === 'IHDR') {
      width = view.getUint32(o + 8);
      height = view.getUint32(o + 12);
      colorType = bytes[o + 17] ?? -1;
    }
    if (type === 'IDAT') idat.push(bytes.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  let n = 0;
  for (const p of idat) n += p.length;
  const all = new Uint8Array(n);
  let w = 0;
  for (const p of idat) {
    all.set(p, w);
    w += p.length;
  }
  const raw = unzlibSync(all);
  const stride = width * 4;
  const rgba = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    if (raw[y * (stride + 1)] !== 0) throw new Error('unexpected filter');
    rgba.set(
      raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
      y * stride,
    );
  }
  return {chunks, width, height, colorType, rgba};
}

/** Files of a ZIP by name (insertion order = archive order). */
export function readZip(zip: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(zip);
}

/** Crops a cell out of RGBA pixels. */
export function crop(
  rgba: Uint8Array,
  sheetW: number,
  x: number,
  y: number,
  w: number,
  h: number,
): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let r = 0; r < h; r++) {
    out.set(
      rgba.subarray(((y + r) * sheetW + x) * 4, ((y + r) * sheetW + x + w) * 4),
      r * w * 4,
    );
  }
  return out;
}

/** UTF-8 text of bytes. */
export function text(bytes: Uint8Array | undefined): string {
  if (bytes === undefined) throw new Error('missing file');
  return new TextDecoder().decode(bytes);
}
