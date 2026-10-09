import {describe, expect, it} from 'vitest';
import {DataTexture} from 'three';
import {float, texture} from 'three/tsl';
import {defaultRenderSettings} from '@csg/parts-schema';
import {buildDefaultPostChain, cellReadbackLayout} from './render-pipeline';
import {SettingsBinder} from './settings-binder';
import {createStageContext} from './stage-context';
import {DEFAULT_POST_STAGES} from './stages/index';

function postContext(binder: SettingsBinder) {
  const color = texture(new DataTexture(new Float32Array(4), 1, 1));
  const nd = texture(new DataTexture(new Float32Array(4), 1, 1));
  const id = texture(new DataTexture(new Float32Array(4), 1, 1));
  return createStageContext({
    binder,
    target: 'post',
    mode: 'export',
    backend: 'webgl2',
    sources: {
      'scene.color': color,
      'scene.normal': nd,
      'scene.depth': nd,
      'scene.partId': id,
      'scene.light': float(1),
    },
  });
}

describe('render pipeline (pure parts)', () => {
  it('AC-PIX-025.1: the default post chain is built in the fixed stage order', () => {
    for (const mode of ['none', 'bayer4'] as const) {
      const s = defaultRenderSettings();
      const settings = {
        ...s,
        palette: {
          ...s.palette,
          id: 'pico-8' as const,
          dither: {mode, strength: 0.5},
        },
      };
      const binder = new SettingsBinder(settings);
      const chain = buildDefaultPostChain(postContext(binder), settings);
      expect(chain.stages).toEqual([...DEFAULT_POST_STAGES]);
      expect(chain.stages).toEqual([
        'coverage',
        'rim',
        'outline',
        'srgb',
        'dither',
        'palette',
        'final-alpha',
      ]);
      expect((chain.output as {isNode?: boolean}).isNode).toBe(true);
      binder.dispose();
    }
  });

  it('AC-PIX-034.1: building the chain registers reserved uniforms once; rebuilding reuses the same nodes', () => {
    const settings = defaultRenderSettings();
    const binder = new SettingsBinder(settings);
    buildDefaultPostChain(postContext(binder), settings);
    const keys = binder.keys();
    const before = keys.map(k => binder.uniformNode(k));
    buildDefaultPostChain(postContext(binder), settings);
    expect(binder.keys()).toEqual(keys);
    expect(keys.map(k => binder.uniformNode(k))).toEqual(before);
    expect(keys).toContain('alpha.cutoff');
    expect(keys).toContain('outline.outer.widthPx');
    expect(keys).toContain('dither.strength');
    expect(keys).toContain('rim.strength');
    expect(keys).toContain('rim.enabled');
  });

  it('AC-PIX-029.1: readback layout for 48 px rows (192 B, padded to 256 on WebGPU; tight, bottom-up on WebGL2)', () => {
    expect(cellReadbackLayout('webgpu', 48)).toEqual({
      rowStrideBytes: 256,
      bottomUp: false,
    });
    expect(cellReadbackLayout('webgl2', 48)).toEqual({
      rowStrideBytes: 192,
      bottomUp: true,
    });
    expect(cellReadbackLayout('webgpu', 64).rowStrideBytes).toBe(256);
    expect(cellReadbackLayout('webgpu', 65).rowStrideBytes).toBe(512);
  });
});
