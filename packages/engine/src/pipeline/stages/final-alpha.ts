/**
 * Final alpha stage (spec 003 REQ-PIX-023, REQ-PIX-025, REQ-PIX-035; the
 * second `post.alphaCutoff@1` of the default post graph).
 *
 * Binary output: a pixel with `alpha ≥ cutoff` becomes opaque (A = 1) with
 * RGB snapped to `k / 255` in the shader, so the RGBA8 target stores exactly
 * the 8-bit codes of REQ-PIX-021 A7 regardless of the hardware's unorm
 * rounding; every other pixel becomes exactly `(0, 0, 0, 0)` (AC-PIX-023.1,
 * AC-PIX-002.2).
 */
import {float, vec4} from 'three/tsl';
import type {Node} from 'three/webgpu';
import type {CompileContext, TslNode} from '@csg/shader-graph/tsl';
import {srgb8Code} from './color-space';

/** Spec 006 catalog node implemented by {@link finalAlpha}. */
export const FINAL_ALPHA_NODE_TYPE = 'post.alphaCutoff@1';

/** Input socket IDs of `post.alphaCutoff@1`. */
export type FinalAlphaInput = 'color' | 'cutoff';
/** Output socket IDs of `post.alphaCutoff@1`. */
export type FinalAlphaOutput = 'color';

/**
 * Inputs of the final `post.alphaCutoff@1` taken from builtins while
 * unconnected: `cutoff ← render.alphaCutoff` (the shared `alpha.cutoff`
 * uniform, so material discard, coverage and final alpha agree, A8).
 *
 * @param ctx - Post compile context.
 * @returns The default `cutoff` input (add `color`).
 */
export function defaultFinalAlphaInputs(
  ctx: CompileContext,
): Readonly<Record<'cutoff', TslNode>> {
  return {cutoff: ctx.builtin('render.alphaCutoff')};
}

/**
 * Final alpha (REQ-PIX-023): `alpha ≥ cutoff` ⇒ `(round8(rgb), 1)`, else
 * `(0, 0, 0, 0)`, with `round8(c) = clamp(floor(c · 255 + 0.5), 0, 255) / 255`.
 * Pure; creates no material or render target (AC-PIX-035.2).
 *
 * @param _ctx - Compile context (unused; defaults via {@link defaultFinalAlphaInputs}).
 * @param inputs - `color` (sRGB RGBA after the palette stage), `cutoff`.
 * @returns `color` with alpha in {0, 1} and 8-bit exact RGB.
 */
export function finalAlpha(
  _ctx: CompileContext,
  inputs: Readonly<Record<FinalAlphaInput, TslNode>>,
  _fields: Readonly<Record<string, never>>,
): Record<FinalAlphaOutput, TslNode> {
  const color = inputs.color as Node<'vec4'>;
  const rgb = (srgb8Code(color.rgb) as Node<'vec3'>).div(255);
  const covered = color.a.greaterThanEqual(inputs.cutoff as Node<'float'>);
  return {
    color: covered.select(vec4(rgb, float(1)), vec4(0, 0, 0, 0)),
  };
}
