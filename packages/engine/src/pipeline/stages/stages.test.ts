/**
 * Emitter shape and stage order of the M2-13 post stages (AC-PIX-025.1,
 * AC-PIX-035.2, AC-PIX-035.3). Node-only: builds TSL nodes, renders nothing.
 */
import {readFileSync} from 'node:fs';
import * as stages from './index';
import {describe, expect, expectTypeOf, it} from 'vitest';
import {vec4} from 'three/tsl';
import {defaultRenderSettings} from '@csg/parts-schema';
import type {StageEmitter} from '@csg/shader-graph/tsl';
import {SettingsBinder} from '../settings-binder';
import {createStageContext} from '../stage-context';
import {
  DEFAULT_POST_STAGES,
  POST_STAGE_NODE_TYPES,
  bayerDither,
  defaultBayerDitherInputs,
  finalAlpha,
  defaultFinalAlphaInputs,
  linearToSrgb,
  paletteQuantize,
  defaultPaletteQuantizeInputs,
} from './index';
import type {BayerDitherFields} from './dither';

function postContext() {
  const binder = new SettingsBinder(defaultRenderSettings());
  return createStageContext({
    binder,
    target: 'post',
    mode: 'export',
    backend: 'webgpu',
  });
}

describe('post stage list', () => {
  it('AC-PIX-025.1: default post stages are in the fixed REQ-PIX-025 order', () => {
    expect([...DEFAULT_POST_STAGES]).toEqual([
      'coverage',
      'rim',
      'outline',
      'srgb',
      'dither',
      'palette',
      'final-alpha',
    ]);
    expect(Object.keys(POST_STAGE_NODE_TYPES).sort()).toEqual(
      [...DEFAULT_POST_STAGES].sort(),
    );
    expect(POST_STAGE_NODE_TYPES.rim).toEqual(['post.rimEdge@1']);
    expect(POST_STAGE_NODE_TYPES.srgb).toEqual(['color.linearToSrgb@1']);
    expect(POST_STAGE_NODE_TYPES.dither).toEqual(['post.bayerDither@1']);
    expect(POST_STAGE_NODE_TYPES.palette).toEqual(['post.paletteQuantize@1']);
    expect(POST_STAGE_NODE_TYPES['final-alpha']).toEqual([
      'post.alphaCutoff@1',
    ]);
  });
});

describe('emitter shape', () => {
  it('AC-PIX-035.2: the stage index exports every M2 stage emitter', () => {
    for (const name of [
      'toonRamp',
      'toonRim',
      'toonCombine',
      'alphaCutoff',
      'rimEdge',
      'edgeDetect',
      'outline',
      'linearToSrgb',
      'bayerDither',
      'paletteQuantize',
      'finalAlpha',
    ] as const) {
      expect(typeof stages[name], name).toBe('function');
    }
  });

  it('AC-PIX-035.3: (ctx, inputs, fields) with catalog socket IDs', () => {
    expectTypeOf(linearToSrgb).toExtend<StageEmitter<'color', 'out'>>();
    expectTypeOf(bayerDither).toExtend<
      StageEmitter<
        'color' | 'px' | 'strength' | 'spread',
        'color' | 'threshold',
        BayerDitherFields
      >
    >();
    expectTypeOf(paletteQuantize).toExtend<
      StageEmitter<'color' | 'lut' | 'enabled', 'color'>
    >();
    expectTypeOf(finalAlpha).toExtend<
      StageEmitter<'color' | 'cutoff', 'color'>
    >();

    const ctx = postContext();
    const color = vec4(0.5, 0.25, 0.125, 1);
    expect(Object.keys(linearToSrgb(ctx, {color}, {}))).toEqual(['out']);
    for (const matrix of [0, 2, 4, 8] as const) {
      const out = bayerDither(
        ctx,
        {color, ...defaultBayerDitherInputs(ctx)},
        {matrix},
      );
      expect(Object.keys(out).sort()).toEqual(['color', 'threshold']);
    }
    expect(
      Object.keys(
        paletteQuantize(ctx, {color, ...defaultPaletteQuantizeInputs(ctx)}, {}),
      ),
    ).toEqual(['color']);
    expect(
      Object.keys(
        finalAlpha(ctx, {color, ...defaultFinalAlphaInputs(ctx)}, {}),
      ),
    ).toEqual(['color']);
  });

  it('AC-PIX-035.2: stages read settings through reserved uniforms and create no material or render target', () => {
    const ctx = postContext();
    const d = defaultBayerDitherInputs(ctx);
    expect(d.strength).toBe(ctx.uniform('dither.strength', 'float', 0));
    expect(defaultFinalAlphaInputs(ctx).cutoff).toBe(
      ctx.uniform('alpha.cutoff', 'float', 0),
    );
    expect(defaultPaletteQuantizeInputs(ctx).lut).toBe(
      ctx.builtin('render.paletteLut'),
    );
    for (const file of [
      'color-space.ts',
      'dither.ts',
      'palette-quantize.ts',
      'final-alpha.ts',
    ]) {
      const src = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
      expect(src, file).not.toMatch(
        /\bnew\s+\w*(Material|RenderTarget|Texture|Mesh)\b|RenderPipeline|\bpass\(/,
      );
    }
  });

  it('AC-PIX-022.3: the dither matrix default is 0 (off) with palette none', () => {
    const s = defaultRenderSettings();
    const binder = new SettingsBinder({
      ...s,
      palette: {
        ...s.palette,
        id: 'none',
        dither: {mode: 'bayer4', strength: 1},
      },
    });
    const ctx = createStageContext({
      binder,
      target: 'post',
      mode: 'export',
      backend: 'webgl2',
    });
    expect(ctx.ditherMatrixSize).toBe(0);
    const color = vec4(0.5, 0.5, 0.5, 1);
    const out = bayerDither(
      ctx,
      {color, ...defaultBayerDitherInputs(ctx)},
      {matrix: ctx.ditherMatrixSize},
    );
    expect(out.color).toBe(color);
  });
});
