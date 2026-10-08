import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {float, int, vec3} from 'three/tsl';
import {defaultRenderSettings} from '@csg/parts-schema';
import type {CompileContext, TslNode} from '@csg/shader-graph/tsl';
import {SettingsBinder, lightDirection} from '../settings-binder';
import {createStageContext} from '../stage-context';
import {
  TOON_COMBINE_INPUTS,
  TOON_RAMP_INPUTS,
  TOON_RAMP_OUTPUTS,
  TOON_RIM_INPUTS,
  TOON_RIM_OUTPUTS,
  defaultToonRampInputs,
  defaultToonRimInputs,
  toonBandIndex,
  toonBandLight,
  toonColor,
  toonCombine,
  toonRamp,
  toonRim,
  toonRimValue,
  toonShade,
} from './toon';

/** Stub context that records the builtins and uniforms a stage asks for. */
function stubContext(): CompileContext & {asked: string[]} {
  const asked: string[] = [];
  return {
    target: 'material',
    mode: 'export',
    backend: 'webgl2',
    asked,
    builtin(name: string): TslNode {
      asked.push(`builtin:${name}`);
      return vec3(0, 0, 1);
    },
    uniform(key: string): TslNode {
      asked.push(`uniform:${key}`);
      return float(0);
    },
  };
}

function nodes(keys: readonly string[]): Record<string, TslNode> {
  return Object.fromEntries(keys.map(k => [k, float(0.5)]));
}

function isNode(value: unknown): boolean {
  return (value as {isNode?: unknown}).isNode === true;
}

function materialContext() {
  const binder = new SettingsBinder(defaultRenderSettings());
  return {
    binder,
    ctx: createStageContext({
      binder,
      target: 'material',
      mode: 'export',
      backend: 'webgpu',
    }),
  };
}

describe('toon stages (REQ-PIX-011..013, A5)', () => {
  it('AC-PIX-011.4: band index counts thresholds <= λ; λ on a threshold goes to the brighter band', () => {
    const t = [1 / 3, 2 / 3];
    expect(toonBandIndex(1 / 3, t, 3)).toBe(1);
    expect(toonBandIndex(1 / 3 - 1e-9, t, 3)).toBe(0);
    expect(toonBandIndex(2 / 3, t, 3)).toBe(2);
    expect(toonBandIndex(1, t, 3)).toBe(2);
    // λ = 0 (back-facing): k = 0 and the color is base · ambient.
    expect(toonBandIndex(0, t, 3)).toBe(0);
    expect(toonBandLight(0, 3, 0.15)).toBe(0.15);
    expect(toonColor(0.8, toonBandLight(0, 3, 0.15), 0)).toBeCloseTo(
      0.8 * 0.15,
      12,
    );
    // Only the first bands - 1 thresholds count (spec 007: the rest are ignored).
    expect(toonBandIndex(0.9, [0.5, 0.6, 0.7], 2)).toBe(1);
    expect(toonBandIndex(0.9, [0.25, 0.5, 0.75], 4)).toBe(3);
  });

  it('AC-PIX-011.3 (CPU): 3 default bands with ambient 0.15 give linear 0.15, 0.575, 1.0 → sRGB 108, 200, 255', () => {
    const lights = [0, 1, 2].map(k => toonBandLight(k, 3, 0.15));
    expect(lights[0]).toBeCloseTo(0.15, 12);
    expect(lights[1]).toBeCloseTo(0.575, 12);
    expect(lights[2]).toBeCloseTo(1, 12);
    const srgb8 = (l: number) =>
      Math.round(
        (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055) * 255,
      );
    expect(lights.map(srgb8)).toEqual([108, 200, 255]);
  });

  it('REQ-PIX-012 (CPU): rim is strength where N.z <= width and dot(N, L) > 0, else 0', () => {
    const l = lightDirection({azimuthDeg: 135, elevationDeg: 45, ambient: 0});
    const s = Math.SQRT1_2;
    // Upper-left silhouette edge: lit, N.z = 0.
    expect(toonRimValue([-s, s, 0], l, 0.2, 1)).toBe(1);
    // Lower-right silhouette edge: unlit side.
    expect(toonRimValue([s, -s, 0], l, 0.2, 1)).toBe(0);
    // Facing the camera: no rim.
    expect(toonRimValue([0, 0, 1], l, 0.2, 1)).toBe(0);
    // Strength 0: never a rim.
    expect(toonRimValue([-s, s, 0], l, 0.2, 0)).toBe(0);
    expect(toonColor(0.9, 1, 0.35)).toBe(1);
  });

  it('AC-PIX-035.2: each stage is an emitter (ctx, inputs, fields) and the module creates no material or render target', () => {
    for (const fn of [toonRamp, toonRim, toonCombine]) {
      expect(typeof fn).toBe('function');
      // Typed as StageEmitter (ctx, inputs, fields); unused trailing params may be omitted.
      expect(fn.length).toBeLessThanOrEqual(3);
    }
    const source = readFileSync(new URL('./toon.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/new\s+\w*(Material|RenderTarget)\b/);
    expect(source).not.toMatch(/\bpass\(|RenderPipeline/);
  });

  it('AC-PIX-035.3: output keys equal the spec 006 catalog sockets of toon.ramp@1 / toon.rim@1', () => {
    const ctx = stubContext();
    const ramp = toonRamp(
      ctx,
      {...nodes(TOON_RAMP_INPUTS), steps: int(3)} as never,
      {},
    );
    expect(Object.keys(ramp).sort()).toEqual([...TOON_RAMP_OUTPUTS].sort());
    for (const v of Object.values(ramp)) expect(isNode(v)).toBe(true);
    const rim = toonRim(ctx, nodes(TOON_RIM_INPUTS) as never, {});
    expect(Object.keys(rim)).toEqual([...TOON_RIM_OUTPUTS]);
    const combined = toonCombine(ctx, nodes(TOON_COMBINE_INPUTS) as never, {});
    expect(Object.keys(combined)).toEqual(['color']);
    // Pure: everything arrives as inputs, nothing is requested from the context.
    expect(ctx.asked).toEqual([]);
    expect([...TOON_RAMP_INPUTS]).toEqual([
      'normal',
      'lightDir',
      'base',
      'steps',
      't1',
      't2',
      't3',
      'ambient',
    ]);
    expect([...TOON_RIM_INPUTS]).toEqual([
      'normal',
      'viewDir',
      'lightDir',
      'width',
      'strength',
    ]);
  });

  it('REQ-PIX-034: default inputs bind the reserved uniforms of the shared binder (spec 007), light.dir is the binder vector', () => {
    const {binder, ctx} = materialContext();
    const ramp = defaultToonRampInputs(ctx, vec3(1, 1, 1));
    expect(ramp.lightDir).toBe(binder.lightDir);
    expect(ramp.steps).toBe(binder.uniformNode('toon.bands'));
    expect(ramp.ambient).toBe(binder.uniformNode('light.ambient'));
    const rim = defaultToonRimInputs(ctx);
    expect(rim.width).toBe(binder.uniformNode('rim.width'));
    expect(rim.strength).toBe(binder.uniformNode('rim.strength'));
    toonShade(ctx, vec3(1, 1, 1));
    expect(binder.keys()).toEqual(
      expect.arrayContaining([
        'light.ambient',
        'rim.enabled',
        'rim.strength',
        'rim.width',
        'toon.bands',
        'toon.thresholds',
      ]),
    );
  });

  it('AC-PIX-013.3: the light uniform is (-0.5, 0.5, 0.70711) for azimuth 135, elevation 45 and does not depend on the camera preset', () => {
    for (const preset of ['side', 'three-quarter', 'isometric'] as const) {
      const s = defaultRenderSettings();
      const binder = new SettingsBinder({
        ...s,
        camera: {...s.camera, preset},
        lighting: {azimuthDeg: 135, elevationDeg: 45, ambient: 0.15},
      });
      const v = binder.lightDir.value;
      expect(v.x).toBeCloseTo(-0.5, 5);
      expect(v.y).toBeCloseTo(0.5, 5);
      expect(v.z).toBeCloseTo(Math.SQRT1_2, 5);
    }
  });
});
