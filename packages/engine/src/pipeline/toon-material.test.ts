import {describe, expect, it} from 'vitest';
import {BackSide} from 'three';
import {vec4} from 'three/tsl';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import {defaultRenderSettings} from '@csg/parts-schema';
import {SettingsBinder} from './settings-binder';
import {createStageContext} from './stage-context';
import {
  SCENE_MRT_KEYS,
  TOON_MATERIAL_USER_DATA,
  createSceneDepthUniforms,
  createSceneMrt,
  createToonMaterial,
  setSceneDepth,
} from './toon-material';

interface Traversable {
  traverse(cb: (n: unknown) => void): void;
}

function graph(root: unknown): unknown[] {
  const out: unknown[] = [];
  (root as Traversable | null)?.traverse(n => out.push(n));
  return out;
}

function setup() {
  const binder = new SettingsBinder(defaultRenderSettings());
  const ctx = createStageContext({
    binder,
    target: 'material',
    mode: 'export',
    backend: 'webgl2',
  });
  return {binder, ctx};
}

describe('toon material (REQ-PIX-011..014, REQ-PIX-023 A8)', () => {
  it('AC-PIX-023.2 (unit): the mask discards alpha below the shared alpha.cutoff uniform; three alphaTest is off; the material is opaque', () => {
    const {binder, ctx} = setup();
    const m = createToonMaterial({ctx, base: vec4(1, 1, 1, 0.4), name: 'Card'});
    expect(m).toBeInstanceOf(MeshBasicNodeMaterial);
    expect(m.name).toBe('Card');
    expect(graph(m.maskNode)).toContain(binder.uniformNode('alpha.cutoff'));
    expect(m.alphaTest).toBe(0);
    expect(m.alphaTestNode).toBeNull();
    expect(m.transparent).toBe(false);
    expect(m.depthWrite).toBe(true);
    expect(m.userData[TOON_MATERIAL_USER_DATA]).toBe('toon');
    m.dispose();
  });

  it('REQ-PIX-011/013: toon lighting reads the binder light.dir and toon uniforms; unlit outputs the base', () => {
    const {binder, ctx} = setup();
    const lit = createToonMaterial({ctx, base: vec4(1, 1, 1, 1)});
    const nodes = graph(lit.colorNode);
    expect(nodes).toContain(binder.lightDir);
    expect(nodes).toContain(binder.uniformNode('toon.bands'));
    expect(nodes).toContain(binder.uniformNode('light.ambient'));
    const unlit = createToonMaterial({
      ctx,
      base: vec4(1, 1, 1, 1),
      lighting: 'unlit',
      side: BackSide,
    });
    expect(graph(unlit.colorNode)).not.toContain(binder.lightDir);
    expect(unlit.side).toBe(BackSide);
    expect(unlit.userData[TOON_MATERIAL_USER_DATA]).toBe('unlit');
    lit.dispose();
    unlit.dispose();
  });

  it('REQ-PIX-034: a uniform change does not touch the material (no rebuild)', () => {
    const {binder, ctx} = setup();
    const m = createToonMaterial({ctx, base: vec4(1, 1, 1, 1)});
    const version = m.version;
    const s = defaultRenderSettings();
    binder.apply({
      ...s,
      toon: {...s.toon, bands: 4},
      lighting: {...s.lighting, azimuthDeg: 30},
      alphaCutoff: 0.3,
    });
    expect(m.version).toBe(version);
    m.dispose();
  });

  it('REQ-PIX-014: scene MRT has output, normalDepth and partId; depth uniforms map the pivot plane to 0 px', () => {
    const depth = createSceneDepthUniforms();
    const node = createSceneMrt(depth);
    expect(Object.keys(node.outputNodes).sort()).toEqual(
      [...SCENE_MRT_KEYS].sort(),
    );
    setSceneDepth(depth, 10, 0.25);
    expect(depth.pivotDistance.value).toBe(10);
    expect(depth.pxPerWorld.value).toBe(4);
    // positionView.z = -10 (the pivot plane) → (10 + -10) · 4 = 0 px.
    expect((depth.pivotDistance.value + -10) * depth.pxPerWorld.value).toBe(0);
  });
});
