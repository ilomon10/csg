/**
 * Outline stage (spec 003 REQ-PIX-015..017, spec 006 `post.outline@1` with the
 * `source` and `black` inputs of amendment A3, m2-plan 2.4). Emitter-shaped
 * (REQ-PIX-035): pure, creates no material and no render target.
 */
import {float, max, select, vec3, vec4} from 'three/tsl';
import type {Node} from 'three/webgpu';
import type {RenderSettings} from '@csg/parts-schema';
import type {
  CompileContext,
  StageEmitter,
  TslNode,
} from '@csg/shader-graph/tsl';
import {pick} from './edge-detect';

/** Spec 006 catalog type of the stage. */
export const OUTLINE_NODE_TYPE = 'post.outline@1';

/** Input socket IDs of `post.outline@1`. */
export const OUTLINE_INPUTS = [
  'color',
  'outer',
  'inner',
  'source',
  'darkenAmount',
  'customColor',
  'black',
] as const;

/** Output socket IDs of `post.outline@1`. */
export const OUTLINE_OUTPUTS = ['color'] as const;

/** An input socket ID of {@link outline}. */
export type OutlineInput = (typeof OUTLINE_INPUTS)[number];

/** An output socket ID of {@link outline}. */
export type OutlineOutput = (typeof OUTLINE_OUTPUTS)[number];

/** Values of the enum field `mode` (spec 006, spec 007 `outline.colorMode`). */
export const OUTLINE_MODES = ['black', 'darken', 'custom'] as const;

/** Outline colour mode (REQ-PIX-017). */
export type OutlineMode = (typeof OUTLINE_MODES)[number];

/** Fields of {@link outline}. */
export interface OutlineFields {
  /** Colour mode (compile-time). An unknown value falls back to `black` (REQ-SGF-042). */
  readonly mode: OutlineMode;
}

/**
 * `post.outline@1`: colours outline pixels (REQ-PIX-017). Where `outer` or
 * `inner` is set, the output is the line colour with alpha 1; elsewhere
 * `color` passes through unchanged.
 *
 * - `black`: `black` (default `render.paletteDarkest`: #000000 without a
 *   palette, else the darkest palette entry).
 * - `darken`: `source.rgb × (1 − darkenAmount)` in linear RGB (`source` from
 *   `post.edgeDetect@1`: the covered neighbour for outer pixels, the pixel's
 *   own colour for inner pixels).
 * - `custom`: `customColor` (linear RGB).
 *
 * The result is linear; the sRGB, dither and palette stages follow
 * (outline colours are quantized like any other colour).
 *
 * @param _ctx - Compile context (unused).
 * @param inputs - Catalog inputs.
 * @param fields - `mode`.
 * @returns `color`.
 */
export const outline: StageEmitter<
  OutlineInput,
  OutlineOutput,
  OutlineFields
> = (_ctx, inputs, fields) => {
  const color = inputs.color as Node<'vec4'>;
  const line = select(
    max(
      inputs.outer as Node<'float'>,
      inputs.inner as Node<'float'>,
    ).greaterThan(0.5),
    float(1),
    float(0),
  );
  let rgb: Node<'vec3'>;
  switch (fields.mode) {
    case 'darken':
      rgb = (inputs.source as Node<'vec4'>).rgb.mul(
        float(1).sub(inputs.darkenAmount as Node<'float'>),
      );
      break;
    case 'custom':
      rgb = vec3(inputs.customColor as Node<'vec3'>);
      break;
    default:
      rgb = (inputs.black as Node<'vec4'>).rgb;
  }
  // Branch-free blend with an exact 0/1 weight (`pick` in edge-detect.ts).
  return {color: pick(color, vec4(rgb, float(1)), line)};
};

/**
 * `mode` field of the built-in post pipeline (spec 007 reserved field
 * `outline.colorMode`).
 *
 * @param o - `RenderSettings.outline`.
 * @returns The `mode` field.
 */
export function outlineFieldsFromSettings(
  o: RenderSettings['outline'],
): OutlineFields {
  return {mode: o.colorMode};
}

/**
 * Default non-wired inputs of {@link outline} in the built-in post pipeline:
 * `darkenAmount ← outline.darkenAmount`, `customColor ← outline.color`,
 * `black ← render.paletteDarkest`. `color`, `outer`, `inner` and `source` come
 * from the coverage and edge-detect stages.
 *
 * @param ctx - A post compile context.
 * @returns The three uniform/builtin inputs.
 */
export function defaultOutlineInputs(
  ctx: CompileContext,
): Record<'darkenAmount' | 'customColor' | 'black', TslNode> {
  return {
    darkenAmount: ctx.uniform('outline.darkenAmount', 'float', undefined),
    customColor: ctx.uniform('outline.color', 'color', undefined),
    black: ctx.builtin('render.paletteDarkest'),
  };
}
