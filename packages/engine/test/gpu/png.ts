/** PNG read/write for golden images (Node only; pngjs). */
import {PNG} from 'pngjs';

/** Decoded RGBA image. */
export interface RgbaImage {
  width: number;
  height: number;
  /** Tightly packed RGBA8, top-left origin. */
  data: Uint8Array;
}

/** Encodes tightly packed RGBA8 as an 8-bit RGBA PNG (deterministic for equal input). */
export function encodePng(
  rgba: Uint8Array,
  width: number,
  height: number,
): Buffer {
  if (rgba.length !== width * height * 4) {
    throw new Error(
      `encodePng: ${rgba.length} bytes for ${width}x${height} RGBA`,
    );
  }
  const png = new PNG({width, height, colorType: 6, filterType: -1});
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  return PNG.sync.write(png, {colorType: 6, inputColorType: 6});
}

/** Decodes a PNG into RGBA8. */
export function decodePng(bytes: Uint8Array): RgbaImage {
  const png = PNG.sync.read(Buffer.from(bytes));
  return {
    width: png.width,
    height: png.height,
    data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length),
  };
}
