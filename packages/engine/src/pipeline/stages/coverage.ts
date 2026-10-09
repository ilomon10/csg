/**
 * Coverage stage (spec 003 REQ-PIX-023, spec 006 `post.alphaCutoff@1`,
 * m2-plan 2.4). Emitter-shaped (REQ-PIX-035): a pure function of the compile
 * context, its input nodes and its fields; it creates no material and no
 * render target.
 */
import {float, step, vec4} from 'three/tsl';
import type {Node} from 'three/webgpu';
import type {
  CompileContext,
  StageEmitter,
  TslNode,
} from '@csg/shader-graph/tsl';
import {loadSceneTexel} from './edge-detect';

/** Spec 006 catalog type of the stage. */
export const ALPHA_CUTOFF_NODE_TYPE = 'post.alphaCutoff@1';

/** Input socket IDs of `post.alphaCutoff@1`. */
export const ALPHA_CUTOFF_INPUTS = ['color', 'cutoff'] as const;

/** Output socket IDs of `post.alphaCutoff@1`. */
export const ALPHA_CUTOFF_OUTPUTS = ['color'] as const;

/** An input socket ID of {@link alphaCutoff}. */
export type AlphaCutoffInput = (typeof ALPHA_CUTOFF_INPUTS)[number];

/** An output socket ID of {@link alphaCutoff}. */
export type AlphaCutoffOutput = (typeof ALPHA_CUTOFF_OUTPUTS)[number];

/**
 * `post.alphaCutoff@1`: coverage = `color.a >= cutoff` (REQ-PIX-023).
 * Covered pixels keep their RGB with alpha 1; every other pixel becomes
 * `(0, 0, 0, 0)`, so the output alpha is exactly 0 or 1 (AC-PIX-023.1).
 *
 * @param _ctx - Compile context (unused: the cutoff arrives as an input).
 * @param inputs - `color` (linear RGB, A = material alpha) and `cutoff`
 *   (default `render.alphaCutoff`, the reserved `alpha.cutoff` uniform).
 * @param _fields - No fields.
 * @returns `color` with alpha in {0, 1}.
 */
export const alphaCutoff: StageEmitter<AlphaCutoffInput, AlphaCutoffOutput> = (
  _ctx,
  inputs,
  _fields,
) => {
  const color = inputs.color as Node<'vec4'>;
  const cutoff = inputs.cutoff as Node<'float'>;
  // Branch-free (see `pick` in edge-detect.ts): exact 0/1 weight.
  const covered = step(cutoff, color.a);
  return {color: vec4(color.rgb, float(1)).mul(covered)};
};

/**
 * Default inputs of {@link alphaCutoff} in the built-in post pipeline:
 * `color ← scene.color`, `cutoff ← render.alphaCutoff` (spec 006 catalog
 * defaults, spec 007 reserved `alpha.cutoff`); `scene.color` is fetched at
 * `screenPos` without filtering.
 *
 * @param ctx - A post compile context.
 * @returns The input record.
 */
export function defaultAlphaCutoffInputs(
  ctx: CompileContext,
): Record<AlphaCutoffInput, TslNode> {
  return {
    color: loadSceneTexel(ctx, 'scene.color', 0, 0).value,
    cutoff: ctx.builtin('render.alphaCutoff'),
  };
}
