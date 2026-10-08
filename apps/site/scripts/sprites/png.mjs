// Minimal PNG encoder (no dependencies). Writes indexed PNGs when the image
// has at most 256 colors, otherwise 8-bit RGBA. Output is deterministic.
import {Buffer} from 'node:buffer';
import {deflateSync} from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * Encodes an RGBA image.
 * @param {number} width
 * @param {number} height
 * @param {Uint8ClampedArray | Uint8Array} rgba
 * @returns {Buffer}
 */
export function encodePng(width, height, rgba) {
  const colors = new Map();
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    const key =
      a === 0
        ? 0
        : ((rgba[i] << 24) | (rgba[i + 1] << 16) | (rgba[i + 2] << 8) | a) >>>
          0;
    if (!colors.has(key)) colors.set(key, colors.size);
    if (colors.size > 256) break;
  }
  const indexed = colors.size <= 256;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = indexed ? 3 : 6;
  const parts = [chunk('IHDR', ihdr)];
  let raw;
  if (indexed) {
    // Stable palette order: transparent first, then by first appearance.
    const entries = [...colors.keys()];
    const plte = Buffer.alloc(entries.length * 3);
    const trns = Buffer.alloc(entries.length);
    entries.forEach((key, i) => {
      plte[i * 3] = (key >>> 24) & 0xff;
      plte[i * 3 + 1] = (key >>> 16) & 0xff;
      plte[i * 3 + 2] = (key >>> 8) & 0xff;
      trns[i] = key & 0xff;
    });
    parts.push(chunk('PLTE', plte), chunk('tRNS', trns));
    raw = Buffer.alloc((width + 1) * height);
    for (let y = 0; y < height; y++) {
      raw[y * (width + 1)] = 0;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const a = rgba[i + 3];
        const key =
          a === 0
            ? 0
            : ((rgba[i] << 24) |
                (rgba[i + 1] << 16) |
                (rgba[i + 2] << 8) |
                a) >>>
              0;
        raw[y * (width + 1) + 1 + x] = colors.get(key);
      }
    }
  } else {
    raw = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) {
      raw[y * (width * 4 + 1)] = 0;
      Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(
        raw,
        y * (width * 4 + 1) + 1,
      );
    }
  }
  parts.push(
    chunk('IDAT', deflateSync(raw, {level: 9})),
    chunk('IEND', Buffer.alloc(0)),
  );
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ...parts,
  ]);
}
