import {describe, expect, it} from 'vitest';
import {float, uniform, vec3} from 'three/tsl';
import {defaultRenderSettings, parseRenderSettings} from '@csg/parts-schema';
import type {CompileContext} from '@csg/shader-graph/tsl';
import {SettingsBinder} from './settings-binder';
import {
  ENGINE_BUILTINS,
  HOST_BUILTINS,
  createStageContext,
} from './stage-context';
import type {StageContextOptions} from './stage-context';

function post(
  binder: SettingsBinder,
  extra: Partial<StageContextOptions> = {},
) {
  return createStageContext({
    binder,
    target: 'post',
    mode: 'export',
    backend: 'webgl2',
    ...extra,
  });
}

describe('stage context (spec 007 CompileContext, REQ-PIX-035)', () => {
  it('carries target, mode and backend and satisfies CompileContext', () => {
    const binder = new SettingsBinder(defaultRenderSettings());
    const ctx: CompileContext = createStageContext({
      binder,
      target: 'material',
      mode: 'preview',
      backend: 'webgpu',
    });
    expect([ctx.target, ctx.mode, ctx.backend]).toEqual([
      'material',
      'preview',
      'webgpu',
    ]);
  });

  it('spec 007 rule 3: render.alphaCutoff and render.ditherStrength are the reserved uniforms', () => {
    const binder = new SettingsBinder(defaultRenderSettings());
    const ctx = post(binder);
    expect(ctx.builtin('render.alphaCutoff')).toBe(
      ctx.uniform('alpha.cutoff', 'float', 0.5),
    );
    expect(ctx.builtin('render.ditherStrength')).toBe(
      ctx.uniform('dither.strength', 'float', 0.5),
    );
  });

  it('AC-PIX-034.1 (unit): material and post contexts share one uniform per key', () => {
    const binder = new SettingsBinder(defaultRenderSettings());
    const material = createStageContext({
      binder,
      target: 'material',
      mode: 'preview',
      backend: 'webgpu',
    });
    const a = material.uniform('rim.strength', 'float', undefined);
    const b = post(binder).uniform('rim.strength', 'float', undefined);
    expect(a).toBe(b);
    // A recompile (new context) reuses the node too.
    expect(post(binder).builtin('render.alphaCutoff')).toBe(
      post(binder).builtin('render.alphaCutoff'),
    );
  });

  it('caches builtins per context and resolves every engine builtin', () => {
    const binder = new SettingsBinder(defaultRenderSettings());
    const material = createStageContext({
      binder,
      target: 'material',
      mode: 'node-preview',
      backend: 'webgl2',
    });
    const postCtx = post(binder);
    for (const name of ENGINE_BUILTINS) {
      const ctx = ['normal', 'viewDir', 'light.dir'].includes(name)
        ? material
        : postCtx;
      const node = ctx.builtin(name);
      expect(node, name).toBeDefined();
      expect(ctx.builtin(name), name).toBe(node);
    }
    expect(material.builtin('light.dir')).toBe(binder.lightDir);
    expect(postCtx.builtin('resolution')).toBe(binder.resolution);
    expect(postCtx.builtin('render.paletteLut')).toBe(binder.paletteLutNode());
    expect(postCtx.builtin('render.paletteEnabled')).toBe(
      binder.paletteEnabled,
    );
    binder.dispose();
  });

  it('AC-PIX-017.4 (builtin): render.paletteDarkest is linear RGBA (0, 0, 0, 1) for palette none', () => {
    const binder = new SettingsBinder(defaultRenderSettings());
    const ctx = post(binder);
    // vec4(paletteDarkest, 1): one node per compile (REQ-SGF-043).
    expect(ctx.builtin('render.paletteDarkest')).toBe(
      ctx.builtin('render.paletteDarkest'),
    );
    expect(binder.paletteDarkest.value.toArray()).toEqual([0, 0, 0]);
  });

  it('REQ-SGF-043: target rules and export time follow the Built-in values table', () => {
    const binder = new SettingsBinder(defaultRenderSettings());
    const p = post(binder);
    expect(() => p.builtin('light.dir')).toThrow(/only available in materials/);
    expect(() => p.builtin('viewDir')).toThrow(/only available in materials/);
    const material = createStageContext({
      binder,
      target: 'material',
      mode: 'preview',
      backend: 'webgpu',
    });
    expect(() => material.builtin('render.alphaCutoff')).toThrow(
      /only available in post/,
    );
    expect(material.builtin('time')).toBe(binder.time);
    const exportTime = p.builtin('time') as unknown as {
      value?: number;
      node?: {value: number};
    };
    expect(exportTime).not.toBe(binder.time);
    expect(exportTime.value ?? exportTime.node?.value).toBe(0);
    // Post `uv` derives from screenPos; material `uv` is the mesh attribute.
    expect(p.builtin('uv')).not.toBe(material.builtin('uv'));
  });

  it('render.ditherMode is the matrix size; 0 when the palette is none (AC-PIX-022.3)', () => {
    const parsed = parseRenderSettings({
      palette: {id: 'pico-8', dither: {mode: 'bayer8'}},
    });
    if (!parsed.ok) throw new Error('settings');
    const binder = new SettingsBinder(parsed.value);
    const ctx = post(binder);
    expect(ctx.ditherMatrixSize).toBe(8);
    expect(ctx.ditherMode).toBe('bayer8');
    // r186 wraps the int constant in a VarNode.
    const node = ctx.builtin('render.ditherMode') as unknown as {
      value?: number;
      node?: {value: number};
    };
    expect(node.value ?? node.node?.value).toBe(8);
    binder.apply(defaultRenderSettings());
    expect(post(binder).ditherMatrixSize).toBe(0);
  });

  it('host builtins come from sources and are target-checked', () => {
    const binder = new SettingsBinder(defaultRenderSettings());
    const sceneColor = vec3(1, 0, 0);
    const ctx = post(binder, {sources: {'scene.color': sceneColor}});
    expect(ctx.builtin('scene.color')).toBe(sceneColor);
    expect(() => ctx.builtin('scene.depth')).toThrow(/not supplied/);
    expect(() => ctx.builtin('part.albedo')).toThrow(
      /only available in materials/,
    );
    expect(() => ctx.builtin('normal')).toThrow(/only available in materials/);
    expect(() => ctx.builtin('tint.skin')).toThrow(
      /only available in materials/,
    );

    const skin = uniform(float(0.5));
    const material = createStageContext({
      binder,
      target: 'material',
      mode: 'export',
      backend: 'webgpu',
      tints: {skin},
    });
    expect(material.builtin('tint.skin')).toBe(skin);
    expect(() => material.builtin('tint.hair')).toThrow(/not supplied/);
    expect(() => material.builtin('tint.nope')).toThrow(/unknown builtin/);
    expect(() => material.builtin('scene.color')).toThrow(
      /only available in post/,
    );
    for (const name of HOST_BUILTINS) {
      const target = name.startsWith('scene.') ? post(binder) : material;
      expect(() => target.builtin(name)).toThrow(/not supplied/);
    }
  });

  it('throws on unknown builtin names (SGF_EMIT_FAILED in M4)', () => {
    const ctx = post(new SettingsBinder(defaultRenderSettings()));
    expect(() => ctx.builtin('render.nope')).toThrow(/unknown builtin/);
    expect(() => ctx.builtin('')).toThrow(/unknown builtin/);
  });

  // GPU test: M2-08 harness. Verify on both backends (forceWebGL and WebGPU):
  // - `screenPos` equals the integer top-left cell pixel (marker at (3, 5) in
  //   a 48×40 cell reads back at row 5, column 3);
  // - `render.paletteEnabled`, `rim.enabled` (0/1 float uniforms exposed as
  //   bool) compile on WGSL and GLSL;
  // - `render.paletteLut` sampled with `.load(ivec2)` returns the uploaded
  //   bytes after `setPalette`, without a pipeline rebuild.
});
