/**
 * Pipeline stage functions (spec 003 REQ-PIX-025, REQ-PIX-035). Each stage
 * is emitter-shaped, `(ctx, inputs, fields) => Record<outputId, node>`, and
 * implements one spec 006 catalog node.
 */
import type {PostStageId} from '../../contracts/pipeline';

/**
 * Post stages of the default post pipeline in their fixed order
 * (REQ-PIX-025, AC-PIX-025.1): coverage (alpha cutoff) → outer and inner
 * outline → sRGB conversion → dither → palette lookup → final alpha.
 */
export const DEFAULT_POST_STAGES = [
  'coverage',
  'outline',
  'srgb',
  'dither',
  'palette',
  'final-alpha',
] as const satisfies readonly PostStageId[];

/**
 * Spec 006 catalog nodes behind each post stage ID, in chain order within a
 * stage (spec 003 Data & contracts, "M2 stage functions").
 */
export const POST_STAGE_NODE_TYPES: Readonly<
  Record<PostStageId, readonly string[]>
> = {
  coverage: ['post.alphaCutoff@1'],
  outline: ['post.edgeDetect@1', 'post.outline@1'],
  srgb: ['color.linearToSrgb@1'],
  dither: ['post.bayerDither@1'],
  palette: ['post.paletteQuantize@1'],
  'final-alpha': ['post.alphaCutoff@1'],
};

// Material stage (M2-11).
export * from './toon';

// Coverage and outline (M2-12).
export * from './coverage';
export * from './edge-detect';
export * from './outline';

// sRGB, dither, palette, final alpha (M2-13).
export * from './color-space';
export * from './dither';
export * from './palette-quantize';
export * from './final-alpha';
