/**
 * Ordered (Bayer) dither stage (spec 003 REQ-PIX-022, REQ-PIX-035; spec 006
 * `post.bayerDither@1`).
 *
 * Adds `((M[y mod n][x mod n] + 0.5) / n² − 0.5) · strength · spread` to each
 * sRGB channel before the palette lookup. `x, y` are cell-local pixel
 * coordinates (top-left origin), so the pattern is anchored to the cell and
 * identical in every frame. The Bayer index is computed from the bits of
 * `x, y` with exact small-integer float math; the CPU oracle is
 * `bayerMatrix` (pipeline/bayer.ts).
 */
import {float, floor, vec4} from 'three/tsl';
import type {Node} from 'three/webgpu';
import type {CompileContext, TslNode} from '@csg/shader-graph/tsl';
import type {BayerSize} from '../bayer';

/** Spec 006 catalog node implemented by {@link bayerDither}. */
export const BAYER_DITHER_NODE_TYPE = 'post.bayerDither@1';

/**
 * Strength 1 shifts a channel by at most ±DITHER_SPREAD / 2 in sRGB [0, 1]
 * (spec 003 Data & contracts; default of the `spread` socket).
 */
export const DITHER_SPREAD = 0.25;

/** Input socket IDs of `post.bayerDither@1`. */
export type BayerDitherInput = 'color' | 'px' | 'strength' | 'spread';
/** Output socket IDs of `post.bayerDither@1`. */
export type BayerDitherOutput = 'color' | 'threshold';

/** Fields of `post.bayerDither@1`. */
export interface BayerDitherFields {
  /**
   * Matrix size (field `matrix`). 0 disables the stage (dither `none`, or
   * palette `none`, AC-PIX-022.3); the default is
   * `StageContext.ditherMatrixSize` (`render.ditherMode`).
   */
  readonly matrix: 0 | BayerSize;
}

/** `M2 = [[0, 2], [3, 1]]` indexed `[y][x]` equals `2 · (x xor y) + y` for bits. */
function m2(bx: number, by: number): number {
  return 2 * (bx ^ by) + by;
}

/**
 * Bayer index by the bit formula used on the GPU:
 * `M = Σ_b M2(bit_b(x), bit_b(y)) · 4^(k − 1 − b)`, `k = log2(n)`, `b = 0` the
 * least significant bit. Equals `bayerMatrix(n)[y mod n][x mod n]` (tested).
 *
 * @param n - Matrix size.
 * @param x - Cell-local x (non-negative integer).
 * @param y - Cell-local y (non-negative integer).
 * @returns The index 0..n² − 1.
 */
export function bayerIndexBits(n: BayerSize, x: number, y: number): number {
  const k = n === 2 ? 1 : n === 4 ? 2 : 3;
  let m = 0;
  for (let b = 0; b < k; b++) {
    m += m2((x >> b) & 1, (y >> b) & 1) * (1 << (2 * (k - 1 - b)));
  }
  return m;
}

/** Bit `b` of a non-negative integer-valued float node: `floor(v / 2^b) mod 2`. */
function bit(v: Node<'float'>, b: number): Node<'float'> {
  // Multiplying by a power of two is exact; floor(h) - 2·floor(h/2) is exact for small integers.
  const h = floor(v.mul(1 / (1 << b)));
  return h.sub(floor(h.mul(0.5)).mul(2));
}

/**
 * Centred Bayer threshold node `(M + 0.5) / n² − 0.5` for integer pixel
 * coordinates (unrolled at compile time; constant bounds, REQ-SGF-042).
 *
 * @param px - Cell-local integer pixel coordinates (`vec2`).
 * @param n - Matrix size.
 * @returns A `float` node in [−0.5, 0.5).
 */
export function bayerThresholdNode(px: TslNode, n: BayerSize): TslNode {
  const p = px as Node<'vec2'>;
  const k = n === 2 ? 1 : n === 4 ? 2 : 3;
  let m: Node<'float'> = float(0);
  for (let b = 0; b < k; b++) {
    const bx = bit(p.x, b);
    const by = bit(p.y, b);
    // xor of two bits = (bx - by)^2 = bx + by - 2·bx·by.
    const xor = bx.add(by).sub(bx.mul(by).mul(2));
    const v = xor.mul(2).add(by);
    m = m.add(v.mul(1 << (2 * (k - 1 - b))));
  }
  return m
    .add(0.5)
    .mul(1 / (n * n))
    .sub(0.5);
}

/**
 * Inputs of `post.bayerDither@1` that come from builtins or catalog defaults
 * when the socket is unconnected: `px ← screenPos`, `strength ←
 * render.ditherStrength` (the `dither.strength` uniform), `spread = 0.25`.
 *
 * @param ctx - Post compile context.
 * @returns The three default inputs (add `color`).
 */
export function defaultBayerDitherInputs(
  ctx: CompileContext,
): Readonly<Record<'px' | 'strength' | 'spread', TslNode>> {
  return {
    px: ctx.builtin('screenPos'),
    strength: ctx.builtin('render.ditherStrength'),
    spread: float(DITHER_SPREAD),
  };
}

/**
 * `post.bayerDither@1` (REQ-PIX-022). With `matrix` 0 the color passes
 * through unchanged and `threshold` is 0; with strength 0 the offset is
 * exactly 0, so the output equals the undithered output byte for byte
 * (AC-PIX-022.1). Pure; creates no material or render target (AC-PIX-035.2).
 *
 * @param _ctx - Compile context (unused; defaults via {@link defaultBayerDitherInputs}).
 * @param inputs - `color` (sRGB RGBA), `px` (cell-local pixel), `strength`, `spread`.
 * @param fields - `matrix`: 0, 2, 4 or 8.
 * @returns `color` with the offset applied to RGB (alpha unchanged, not
 *   clamped) and the centred `threshold`.
 */
export function bayerDither(
  _ctx: CompileContext,
  inputs: Readonly<Record<BayerDitherInput, TslNode>>,
  fields: Readonly<BayerDitherFields>,
): Record<BayerDitherOutput, TslNode> {
  const color = inputs.color as Node<'vec4'>;
  if (fields.matrix === 0) return {color, threshold: float(0)};
  const threshold = bayerThresholdNode(
    inputs.px,
    fields.matrix,
  ) as Node<'float'>;
  const offset = threshold
    .mul(inputs.strength as Node<'float'>)
    .mul(inputs.spread as Node<'float'>);
  return {color: vec4(color.rgb.add(offset), color.a), threshold};
}
