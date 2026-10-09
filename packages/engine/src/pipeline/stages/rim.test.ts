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

describe('rim edge (REQ-PIX-012, FX-J)', () => {
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
