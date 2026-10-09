/**
 * Palette lookup stage (spec 003 REQ-PIX-018, REQ-PIX-021 amendment A7,
 * REQ-PIX-035; spec 006 `post.paletteQuantize@1`).
 *
 * The GPU only looks up the CPU-built LUT (`buildPaletteLut`, palette-lut.ts):
 * `c8 = clamp(floor(c · 255 + 0.5), 0, 255)`, `i = floor((c8 · 63 + 127) / 255)`
 * per channel, then an integer texel fetch of entry `(r, g, b)` at
 * `((b mod 8) · 64 + r, floor(b / 8) · 64 + g)` in the 512×512 RGBA8 texture.
 * The texel's RGB is the palette color (8-bit sRGB), its A the palette index.
 * The CPU reference of the whole lookup is `quantizeReference`.
 */
import {floor, int, ivec2, vec4} from 'three/tsl';
import type {Node, TextureNode} from 'three/webgpu';
import type {CompileContext, TslNode} from '@csg/shader-graph/tsl';
import {PALETTE_LUT_SIZE} from '../palette-lut';
import {srgb8Code} from './color-space';

/** Spec 006 catalog node implemented by {@link paletteQuantize}. */
export const PALETTE_QUANTIZE_NODE_TYPE = 'post.paletteQuantize@1';

/** Input socket IDs of `post.paletteQuantize@1`. */
export type PaletteQuantizeInput = 'color' | 'lut' | 'enabled';
/** Output socket IDs of `post.paletteQuantize@1`. */
export type PaletteQuantizeOutput = 'color';

/** Tiles per LUT texture row (512 / 64). */
const TILES_PER_ROW = 8;

/**
 * LUT level of 8-bit codes, `floor((c8 · 63 + 127) / 255)` (A7), in float
 * math that is exact on every GPU: the true quotient's fractional part is a
 * multiple of 1/255, so adding half a step (`+ 0.5` to the numerator) keeps
 * it at least 0.5/255 away from an integer, far above the division error.
 *
 * @param c8 - 8-bit codes (integer-valued `float`..`vec4`).
 * @returns Levels 0..63 (integer-valued, same type).
 */
export function lutIndexNode(c8: TslNode): TslNode {
  return floor((c8 as Node<'vec3'>).mul(63).add(127.5).div(255));
}

/**
 * Integer texel coordinates of LUT entry `(r, g, b)` (levels 0..63) in the
 * 512×512 texture (A7 layout).
 *
 * @param level - `vec3` of integer-valued levels.
 * @returns `ivec2` texel coordinates, row 0 = first uploaded row.
 */
export function lutTexelCoord(level: TslNode): TslNode {
  const l = level as Node<'vec3'>;
  // b / 8 as b · 0.125: exact; b mod 8 = b − 8 · floor(b / 8): exact.
  const tileRow = floor(l.z.mul(1 / TILES_PER_ROW));
  const tileCol = l.z.sub(tileRow.mul(TILES_PER_ROW));
  return ivec2(
    int(tileCol.mul(PALETTE_LUT_SIZE).add(l.x)),
    int(tileRow.mul(PALETTE_LUT_SIZE).add(l.y)),
  );
}

/**
 * The raw LUT texel for an sRGB color: RGB = palette color, A = palette
 * index / 255 (A7). Used by {@link paletteQuantize} and by the debug readback
 * of AC-PIX-021.3.
 *
 * @param lut - `render.paletteLut` texture node.
 * @param color - sRGB color (`vec3`/`vec4`; only RGB is read).
 * @returns The fetched texel (`vec4`).
 */
export function paletteLutTexel(lut: TslNode, color: TslNode): TslNode {
  const c8 = srgb8Code((color as Node<'vec4'>).rgb);
  return (lut as unknown as TextureNode).load(
    lutTexelCoord(lutIndexNode(c8)) as Node<'ivec2'>,
  );
}

/**
 * Inputs of `post.paletteQuantize@1` taken from builtins while unconnected:
 * `lut ← render.paletteLut`, `enabled ← render.paletteEnabled`.
 *
 * @param ctx - Post compile context.
 * @returns The two default inputs (add `color`).
 */
export function defaultPaletteQuantizeInputs(
  ctx: CompileContext,
): Readonly<Record<'lut' | 'enabled', TslNode>> {
  return {
    lut: ctx.builtin('render.paletteLut'),
    enabled: ctx.builtin('render.paletteEnabled'),
  };
}

/**
 * `post.paletteQuantize@1` (REQ-PIX-018, REQ-PIX-021): replaces the sRGB
 * color by its nearest palette entry through the LUT; alpha unchanged. When
 * `enabled` is false (palette `none`) the color passes through unchanged
 * (AC-PIX-018.2). `enabled` is a uniform, so a palette change never
 * recompiles. Pure; creates no material or render target (AC-PIX-035.2).
 *
 * @param _ctx - Compile context (unused; defaults via {@link defaultPaletteQuantizeInputs}).
 * @param inputs - `color` (sRGB RGBA), `lut` (texture node), `enabled` (bool).
 * @returns `color`: the palette color (8-bit exact) with the input alpha.
 */
export function paletteQuantize(
  _ctx: CompileContext,
  inputs: Readonly<Record<PaletteQuantizeInput, TslNode>>,
  _fields: Readonly<Record<string, never>>,
): Record<PaletteQuantizeOutput, TslNode> {
  const color = inputs.color as Node<'vec4'>;
  const texel = paletteLutTexel(inputs.lut, color) as Node<'vec4'>;
  const quantized = vec4(texel.rgb, color.a);
  const enabled = inputs.enabled as Node<'bool'>;
  return {color: enabled.select(quantized, color)};
}
