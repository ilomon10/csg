/**
 * Minimal WebP container reader for thumbnail checks (REQ-AST-015): RIFF header, the first chunk
 * and the image size. Pure; reads untrusted bytes defensively and never decodes pixels.
 */

/** What {@link readWebpInfo} found. */
export interface WebpInfo {
  /** `VP8L` (lossless), `VP8 ` (lossy) or `VP8X` (extended). */
  readonly chunk: 'VP8L' | 'VP8 ' | 'VP8X';
  readonly width: number;
  readonly height: number;
}

const ascii = (b: Uint8Array, at: number, n: number) =>
  String.fromCharCode(...b.subarray(at, at + n));

/** Parses the header of a WebP file; `null` when it is not one. */
export function readWebpInfo(bytes: Uint8Array): WebpInfo | null {
  if (bytes.length < 30) return null;
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP')
    return null;
  const riffSize =
    (bytes[4]! | (bytes[5]! << 8) | (bytes[6]! << 16) | (bytes[7]! << 24)) >>>
    0;
  if (riffSize + 8 !== bytes.length) return null;
  const chunk = ascii(bytes, 12, 4);
  const d = 20;
  if (chunk === 'VP8L') {
    if (bytes[d] !== 0x2f) return null;
    const b1 = bytes[d + 1]!;
    const b2 = bytes[d + 2]!;
    const b3 = bytes[d + 3]!;
    const b4 = bytes[d + 4]!;
    const width = 1 + (((b2 & 0x3f) << 8) | b1);
    const height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
    return {chunk, width, height};
  }
  if (chunk === 'VP8 ') {
    if (bytes[d + 3] !== 0x9d || bytes[d + 4] !== 0x01 || bytes[d + 5] !== 0x2a)
      return null;
    const width = (bytes[d + 6]! | (bytes[d + 7]! << 8)) & 0x3fff;
    const height = (bytes[d + 8]! | (bytes[d + 9]! << 8)) & 0x3fff;
    return {chunk, width, height};
  }
  if (chunk === 'VP8X') {
    const width =
      1 + (bytes[d + 4]! | (bytes[d + 5]! << 8) | (bytes[d + 6]! << 16));
    const height =
      1 + (bytes[d + 7]! | (bytes[d + 8]! << 8) | (bytes[d + 9]! << 16));
    return {chunk, width, height};
  }
  return null;
}
