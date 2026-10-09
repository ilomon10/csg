/**
 * Screen-space rim edge (spec 003 REQ-PIX-012 as amended by FX-J): CPU twins
 * and the emitter shape. GPU behaviour: `test/gpu/rim.gpu.ts`.
 */
import {describe, expect, it} from 'vitest';
import {float, texture, vec4} from 'three/tsl';
import {DataTexture} from 'three';
import {defaultRenderSettings} from '@csg/parts-schema';
import {SettingsBinder, lightDirection} from '../settings-binder';
import {createStageContext} from '../stage-context';
import {
  RIM_EDGE_INPUTS,
  RIM_EDGE_NODE_TYPE,
  RIM_EDGE_OUTPUTS,
  RIM_MIN_SCREEN_LIGHT,
  RIM_TIE_EPSILON_DEG,
  defaultRimEdgeInputs,
  rimCombine,
  rimEdge,
  rimMask,
  rimOffset,
} from './rim';

const dir = (azimuthDeg: number, elevationDeg = 45) =>
  lightDirection({azimuthDeg, elevationDeg, ambient: 0.15});

function postContext(binder: SettingsBinder) {
  const tex = texture(new DataTexture(new Uint8Array(4), 1, 1));
  return createStageContext({
    binder,
    target: 'post',
    mode: 'export',
    backend: 'webgpu',
    sources: {
      'scene.color': tex,
      'scene.normal': tex,
      'scene.depth': tex,
      'scene.partId': tex,
      'scene.light': float(1),
    },
  });
}

/** The 8 offsets of sectors 0..7 (REQ-PIX-012 note). */
const SECTORS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

/**
 * The GPU quantization of `rimEdge` evaluated in float32 (each TSL op
 * rounded with `Math.fround`), from a float32 light uniform: the same
 * branch-free steps as the shader.
 */
function gpuRimOffset(
  l: readonly [number, number, number],
): readonly [number, number] | null {
  const f = Math.fround;
  const x = f(l[0]);
  const y = f(l[1]);
  const len = f(Math.hypot(x, y));
  if (len < f(RIM_MIN_SCREEN_LIGHT)) return null;
  const e = (RIM_TIE_EPSILON_DEG * Math.PI) / 180;
  const c = f(Math.cos(e));
  const s = f(Math.sin(e));
  const nx = f(f(f(x * c) - f(y * s)) / len);
  const ny = f(f(f(x * s) + f(y * c)) / len);
  const edge = f(0.3826834323650898);
  const step = (a: number, b: number) => (b >= a ? 1 : 0);
  const dx = step(edge, nx) - step(edge, -nx);
  const dy = step(edge, -ny) - step(edge, ny);
  return [dx, dy];
}

describe('rim edge (REQ-PIX-012, FX-J)', () => {
  it('AC-PIX-012.3 / review L3: a light exactly on a sector boundary (22.5° + 45°k) goes counter-clockwise, on the GPU path and in rimOffset', () => {
    for (let k = 0; k < 8; k++) {
      const boundary = 22.5 + 45 * k;
      const ccw = SECTORS[(k + 1) % 8];
      for (const elevation of [0, 45, 80]) {
        const l = dir(boundary, elevation);
        expect(rimOffset(l), `${boundary}° CPU`).toEqual(ccw);
        expect(gpuRimOffset(l), `${boundary}° GPU`).toEqual(ccw);
        // Clearly inside either sector: unchanged by the tie epsilon.
        for (const delta of [-0.01, 0.01, -10, 10]) {
          const a = boundary + delta;
          const expected = SECTORS[(delta < 0 ? k : k + 1) % 8];
          expect(rimOffset(dir(a, elevation)), `${a}° CPU`).toEqual(expected);
          expect(gpuRimOffset(dir(a, elevation)), `${a}° GPU`).toEqual(
            expected,
          );
        }
      }
    }
  });

  it('AC-PIX-012.3: the GPU quantization equals rimOffset for every whole and half degree', () => {
    for (let a = 0; a < 360; a += 0.5) {
      expect(gpuRimOffset(dir(a)), `${a}°`).toEqual(rimOffset(dir(a)));
    }
    expect(gpuRimOffset(dir(77, 90))).toBeNull();
  });

  it('AC-PIX-012.3: rim offset is the 8-way sector of the screen light; elevation 90° gives none', () => {
    expect(rimOffset(dir(135))).toEqual([-1, -1]);
    expect(rimOffset(dir(0))).toEqual([1, 0]);
    expect(rimOffset(dir(90))).toEqual([0, -1]);
    expect(rimOffset(dir(180))).toEqual([-1, 0]);
    expect(rimOffset(dir(315))).toEqual([1, 1]);
    expect(rimOffset(dir(22.4))).toEqual([1, 0]);
    expect(rimOffset(dir(22.6))).toEqual([1, -1]);
    expect(rimOffset(dir(45))).toEqual([1, -1]);
    for (const a of [0, 77, 135, 300]) expect(rimOffset(dir(a, 90))).toBeNull();
  });

  it('AC-PIX-012.4 (CPU): a 16×16 face gets a 1 px L-shaped rim on its top row and left column (31 px)', () => {
    const w = 32;
    const covered = Array.from({length: w * w}, (_, i) => {
      const x = i % w;
      const y = Math.floor(i / w);
      return x >= 8 && x < 24 && y >= 8 && y < 24;
    });
    const mask = rimMask(covered, w, w, dir(135));
    const rim: Array<[number, number]> = [];
    mask.forEach((v, i) => {
      if (v === 1) rim.push([i % w, Math.floor(i / w)]);
    });
    expect(rim).toHaveLength(31);
    expect(rim.every(([x, y]) => x === 8 || y === 8)).toBe(true);
    // Light from the viewer: no rim at all.
    expect(rimMask(covered, w, w, dir(135, 90)).every(v => v === 0)).toBe(true);
  });

  it('REQ-PIX-012 (PM FX-J combine): rim channel is clamp(base · (light_k + strength)); light_k = 0 keeps the colour', () => {
    // base 0.5 in band light_k 0.575 → c = 0.2875; rim → 0.5 · 0.875.
    expect(rimCombine(0.5 * 0.575, 0.575, 0.3)).toBeCloseTo(0.4375, 12);
    // Brightest band stays visible (clamped per channel).
    expect(rimCombine(0.5, 1, 0.3)).toBeCloseTo(0.65, 12);
    expect(rimCombine(0.9, 1, 0.3)).toBe(1);
    expect(rimCombine(0.25, 0, 0.3)).toBe(0.25);
  });

  it('AC-PIX-012.11: rim combine is clamp(base · (light_k + strength)) per channel (c = base · light_k)', () => {
    const base = (b: number, k: number, s: number) => rimCombine(b * k, k, s);
    // light_k 0: the pixel colour passes through unchanged (rimCombine takes
    // the lit colour c; the spec's "base 0.25" is that unchanged colour).
    expect(rimCombine(0.25, 0, 0.3)).toBeCloseTo(0.25, 6);
    expect(base(0.5, 1, 0.5)).toBeCloseTo(0.75, 6);
    expect(base(0.8, 1, 0.5)).toBeCloseTo(1.0, 6);
    expect(base(0.4, 0.55, 0.5)).toBeCloseTo(0.42, 6);
  });

  it('AC-PIX-035.3: post.rimEdge@1 sockets; defaults bind the reserved rim uniforms, light.dir and scene.light', () => {
    expect(RIM_EDGE_NODE_TYPE).toBe('post.rimEdge@1');
    const binder = new SettingsBinder(defaultRenderSettings());
    const ctx = postContext(binder);
    const inputs = defaultRimEdgeInputs(ctx);
    expect(Object.keys(inputs).sort()).toEqual(
      RIM_EDGE_INPUTS.filter(k => k !== 'color').sort(),
    );
    expect(inputs.lightDir).toBe(binder.lightDir);
    expect(inputs.light).toBe(ctx.builtin('scene.light'));
    expect(inputs.strength).toBe(binder.uniformNode('rim.strength'));
    const out = rimEdge(ctx, {color: vec4(1, 1, 1, 1), ...inputs}, {});
    expect(Object.keys(out)).toEqual([...RIM_EDGE_OUTPUTS]);
    // Uniform-only: a second build reuses the same uniform nodes (REQ-PIX-034).
    const again = defaultRimEdgeInputs(postContext(binder));
    expect(again.strength).toBe(inputs.strength);
    expect(again.enabled).toBe(inputs.enabled);
    binder.dispose();
  });
});
