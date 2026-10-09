/** Side of the avatar crop in the source frame (decision D5). */
export const AVATAR_CROP_PX = 32;
/** Side of the stored avatar (`HOME_RENDER_PROFILE.avatarSize`). */
export const AVATAR_PX = 64;

/** A rendered cell: RGBA8, straight alpha, tightly packed, top-left origin. */
export interface PixelFrame {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
}

/**
 * The head-and-shoulders avatar of a frame (decision D5, REQ-UX-080): a 32 x 32 crop centred
 * on the centre of the opaque columns and top-aligned to the first opaque row, enlarged 2x by
 * nearest neighbour to 64 x 64. Pixels outside the frame are transparent; a frame with no
 * opaque pixel gives a fully transparent avatar. Pure and deterministic.
 */
export function cropAvatar(frame: PixelFrame): Uint8ClampedArray {
  const {width, height, pixels} = frame;
  const out = new Uint8ClampedArray(AVATAR_PX * AVATAR_PX * 4);
  let minX = width;
  let maxX = -1;
  let firstRow = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((pixels[(y * width + x) * 4 + 3] ?? 0) === 0) continue;
      if (firstRow < 0) firstRow = y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  if (firstRow < 0) return out;
  const x0 = Math.floor((minX + maxX) / 2) - AVATAR_CROP_PX / 2;
  const y0 = firstRow;
  const scale = AVATAR_PX / AVATAR_CROP_PX;
  for (let y = 0; y < AVATAR_PX; y++) {
    const sy = y0 + Math.floor(y / scale);
    if (sy < 0 || sy >= height) continue;
    for (let x = 0; x < AVATAR_PX; x++) {
      const sx = x0 + Math.floor(x / scale);
      if (sx < 0 || sx >= width) continue;
      const s = (sy * width + sx) * 4;
      const d = (y * AVATAR_PX + x) * 4;
      out[d] = pixels[s] ?? 0;
      out[d + 1] = pixels[s + 1] ?? 0;
      out[d + 2] = pixels[s + 2] ?? 0;
      out[d + 3] = pixels[s + 3] ?? 0;
    }
  }
  return out;
}

/** Lays equally sized frames side by side: `(width x n) x height`. */
export function composeStrip(frames: readonly PixelFrame[]): PixelFrame {
  const first = frames[0];
  if (first === undefined) throw new Error('composeStrip: no frames');
  const {width, height} = first;
  const stripW = width * frames.length;
  const pixels = new Uint8ClampedArray(stripW * height * 4);
  frames.forEach((frame, i) => {
    for (let y = 0; y < height; y++) {
      const row = frame.pixels.subarray(y * width * 4, (y + 1) * width * 4);
      pixels.set(row, (y * stripW + i * width) * 4);
    }
  });
  return {width: stripW, height, pixels};
}

/**
 * The strip frame to draw at `elapsedMs`: looping at `fps`, or still frame 0 where reduced
 * motion is in effect (REQ-UX-084).
 */
export function frameIndexAt(
  frameCount: number,
  fps: number,
  elapsedMs: number,
  reducedMotion: boolean,
): number {
  if (reducedMotion || frameCount <= 1 || fps <= 0) return 0;
  return Math.floor((Math.max(0, elapsedMs) * fps) / 1000) % frameCount;
}
