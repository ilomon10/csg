/**
 * sRGB conversion stage (spec 003 REQ-PIX-024, REQ-PIX-035; spec 006
 * `color.linearToSrgb@1`). The pipeline lights in linear RGB with
 * `outputColorTransform` disabled and converts to sRGB exactly once, here,
 * immediately before dither and palette lookup.
 *
 * Also hosts the 8-bit encode helper shared by the palette lookup and the
 * final alpha stage (REQ-PIX-021 amendment A7: `c8 = clamp(floor(c · 255 +
 * 0.5), 0, 255)`).
 */
import {clamp, float, floor, max, mix, pow, step, vec4} from 'three/tsl';
import type {Node} from 'three/webgpu';
import type {CompileContext, TslNode} from '@csg/shader-graph/tsl';

/** Spec 006 catalog node implemented by {@link linearToSrgb}. */
export const LINEAR_TO_SRGB_NODE_TYPE = 'color.linearToSrgb@1';

/** Input socket IDs of `color.linearToSrgb@1`. */
export type LinearToSrgbInput = 'color';
/** Output socket IDs of `color.linearToSrgb@1`. */
export type LinearToSrgbOutput = 'out';

/** Linear value below which the IEC 61966-2-1 OETF is the linear segment. */
const OETF_LINEAR_LIMIT = 0.0031308;

/**
 * IEC 61966-2-1 sRGB OETF on a linear `vec3`: `12.92 · c` for
 * `c < 0.0031308`, else `1.055 · c^(1/2.4) − 0.055`.
 *
 * Deliberately not TSL `sRGBTransferOETF`: r186 uses the exponent `0.41666`
 * instead of `1 / 2.4` and its `mix` turns the NaN of `pow(c < 0, …)` into a
 * NaN result. Here `pow` only sees `c ≥ 0.0031308`, and `mix` with an exact
 * 0/1 weight returns one branch unchanged, so the result tracks the CPU
 * reference `linearToSrgb8` (srgb8.ts) up to GPU `pow` precision.
 *
 * @param rgb - Linear RGB.
 * @returns Non-linear sRGB in the same range (not clamped).
 */
export function srgbOetf(rgb: TslNode): TslNode {
  const c = rgb as Node<'vec3'>;
  const curve = pow(max(c, float(OETF_LINEAR_LIMIT)), float(1 / 2.4))
    .mul(1.055)
    .sub(0.055);
  const linear = c.mul(12.92);
  // step(edge, x) = x >= edge ? 1 : 0 per channel.
  return mix(linear, curve, step(float(OETF_LINEAR_LIMIT), c));
}

/**
 * 8-bit code of a non-linear channel value, as a float holding an integer:
 * `clamp(floor(c · 255 + 0.5), 0, 255)` (REQ-PIX-021 A7). Works per channel
 * on `float` to `vec4`.
 *
 * @param c - sRGB value(s) in [0, 1] (values outside are clamped).
 * @returns The code(s) 0..255.
 */
export function srgb8Code(c: TslNode): TslNode {
  return clamp(floor((c as Node<'vec4'>).mul(255).add(0.5)), 0, 255);
}

/**
 * `color.linearToSrgb@1` (REQ-PIX-024): converts linear RGB to sRGB with the
 * exact IEC OETF; alpha is unchanged. Pure; creates no material or render
 * target (AC-PIX-035.2).
 *
 * @param _ctx - Compile context (unused; the stage has no builtins).
 * @param inputs - `color`: linear RGBA.
 * @returns `out`: sRGB RGB with the input alpha.
 */
export function linearToSrgb(
  _ctx: CompileContext,
  inputs: Readonly<Record<LinearToSrgbInput, TslNode>>,
  _fields: Readonly<Record<string, never>>,
): Record<LinearToSrgbOutput, TslNode> {
  const color = inputs.color as Node<'vec4'>;
  return {out: vec4(srgbOetf(color.rgb) as Node<'vec3'>, color.a)};
}
