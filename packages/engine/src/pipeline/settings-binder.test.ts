import {describe, expect, it} from 'vitest';
import type {Vector3} from 'three';
import {Color} from 'three';
import type {DataTexture} from 'three';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import {vec3} from 'three/tsl';
import type {Node} from 'three/webgpu';
import {defaultRenderSettings, parseRenderSettings} from '@csg/parts-schema';
import type {RenderSettings} from '@csg/parts-schema';
import {PALETTE_LUT_BYTES} from './palette-lut';
import {outlineFieldsFromSettings} from './stages/outline';
import {srgb8ToLinear} from './srgb8';
import {
  RESERVED_NON_UNIFORM_IDS,
  activePaletteColors,
  RESERVED_UNIFORM_PARAMS,
  SettingsBinder,
  diffRenderSettings,
  isUniformOnly,
  lightDirection,
  postStructureKey,
  reservedUniformValues,
  toonThresholds,
} from './settings-binder';

function settings(input: unknown): RenderSettings {
  const r = parseRenderSettings(input);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}

function withRim(s: RenderSettings, strength: number): RenderSettings {
  return {...s, toon: {...s.toon, rim: {...s.toon.rim, strength}}};
}

function leafPaths(value: unknown, path = ''): string[] {
  if (typeof value !== 'object' || value === null) return [path];
  if (Array.isArray(value) && value.length === 0) return [path];
  return Object.keys(value).flatMap(k =>
    leafPaths(
      (value as Record<string, unknown>)[k],
      path === '' ? k : `${path}.${k}`,
    ),
  );
}

describe('settings binder: reserved IDs (spec 007)', () => {
  it('AC-SGF-041.1 (engine side): reserved uniform types follow the spec 007 table', () => {
    expect(RESERVED_UNIFORM_PARAMS).toEqual({
      'toon.bands': 'int',
      'toon.thresholds': 'vec3',
      'rim.enabled': 'bool',
      'rim.strength': 'float',
      'rim.width': 'float',
      'light.azimuthDeg': 'float',
      'light.elevationDeg': 'float',
      'light.ambient': 'float',
      'outline.outer.enabled': 'bool',
      'outline.outer.widthPx': 'int',
      'outline.inner.enabled': 'bool',
      'outline.inner.depthThresholdPx': 'float',
      'outline.inner.normalThresholdDeg': 'float',
      'outline.darkenAmount': 'float',
      'outline.color': 'color',
      'dither.strength': 'float',
      'alpha.cutoff': 'float',
    });
    const binder = new SettingsBinder(defaultRenderSettings());
    expect(() => binder.uniform('dither.strength', 'int', 0)).toThrow(
      /must be float/,
    );
    for (const id of RESERVED_NON_UNIFORM_IDS) {
      expect(() => binder.uniform(id, 'float', 0)).toThrow(/not a uniform/);
    }
  });

  it('maps every typed field to its reserved ID with the default values', () => {
    const v = reservedUniformValues(defaultRenderSettings('three-quarter'));
    expect(v['toon.bands']).toBe(3);
    expect(v['toon.thresholds']).toEqual([1 / 3, 2 / 3, 2]);
    expect(v['rim.enabled']).toBe(true);
    expect(v['rim.strength']).toBe(0.5);
    expect(v['rim.width']).toBe(0.25);
    expect(v['light.azimuthDeg']).toBe(135);
    expect(v['light.elevationDeg']).toBe(45);
    expect(v['light.ambient']).toBe(0.1);
    expect(v['outline.outer.enabled']).toBe(true);
    expect(v['outline.outer.widthPx']).toBe(1);
    expect(v['outline.inner.enabled']).toBe(true);
    expect(v['outline.inner.depthThresholdPx']).toBe(4);
    expect(v['outline.inner.normalThresholdDeg']).toBe(60);
    expect(v['outline.darkenAmount']).toBe(0.6);
    expect(v['outline.color']).toBe('#000000');
    expect(v['dither.strength']).toBe(0.5);
    expect(v['alpha.cutoff']).toBe(0.5);
  });

  it('fills explicit and evenly spaced toon thresholds into a vec3', () => {
    expect(toonThresholds({...defaultRenderSettings().toon, bands: 2})).toEqual(
      [0.5, 2, 2],
    );
    expect(
      toonThresholds({
        ...defaultRenderSettings().toon,
        bands: 4,
        thresholds: [0.1, 0.5, 0.9],
      }),
    ).toEqual([0.1, 0.5, 0.9]);
  });

  it('AC-PIX-013.3: light direction for azimuth 135 and elevation 45', () => {
    const [x, y, z] = lightDirection({
      azimuthDeg: 135,
      elevationDeg: 45,
      ambient: 0.15,
    });
    expect(x).toBeCloseTo(-0.5, 5);
    expect(y).toBeCloseTo(0.5, 5);
    expect(z).toBeCloseTo(0.70711, 5);
    for (const preset of ['side', 'three-quarter', 'isometric'] as const) {
      const binder = new SettingsBinder(defaultRenderSettings(preset));
      expect(binder.lightDir.value.toArray()).toEqual([x, y, z]);
    }
  });
});

describe('settings binder: uniform cache', () => {
  it('returns the same node for the same key and writes reserved values', () => {
    const binder = new SettingsBinder(defaultRenderSettings());
    const a = binder.uniform('rim.strength', 'float', 0.9);
    expect(binder.uniform('rim.strength', 'float', 0.1)).toBe(a);
    expect(binder.uniformNode('rim.strength')?.value).toBe(0.5);
    expect(() => binder.uniform('rim.strength', 'vec3', 0)).toThrow(/is float/);
  });

  it('accepts user params and inline keys, rejects other keys', () => {
    const s = settings({params: {glow: 0.7, tintA: '#ff0000'}});
    const binder = new SettingsBinder(s);
    binder.uniform('glow', 'float', 0);
    expect(binder.uniformNode('glow')?.value).toBe(0.7);
    binder.uniform('tintA', 'color', '#000000');
    const red = new Color().setRGB(1, 0, 0);
    expect((binder.uniformNode('tintA')?.value as Color).equals(red)).toBe(
      true,
    );
    binder.uniform('node:n12.strength', 'vec3', [1, 2, 3]);
    expect(
      (binder.uniformNode('node:n12.strength')?.value as Vector3).toArray(),
    ).toEqual([1, 2, 3]);
    expect(() => binder.uniform('bad key', 'float', 0)).toThrow(/invalid/);
    expect(() => binder.uniform('x.y', 'float', 0)).toThrow(/invalid/);
    expect(() => binder.uniform('ok', 'float', 'nope')).toThrow(
      /invalid value/,
    );
    expect(binder.keys()).toEqual(['glow', 'node:n12.strength', 'tintA']);
  });

  it('defers reserved values requested before the first apply', () => {
    const binder = new SettingsBinder();
    binder.uniform('alpha.cutoff', 'float', undefined);
    binder.uniform('rim.enabled', 'bool', undefined);
    binder.apply(settings({alphaCutoff: 0.25}));
    expect(binder.uniformNode('alpha.cutoff')?.value).toBe(0.25);
    expect(binder.uniformNode('rim.enabled')?.value).toBe(1);
  });

  it('stores bool params as 0/1 floats (WGSL has no bool uniforms)', () => {
    const s = defaultRenderSettings();
    const binder = new SettingsBinder(s);
    binder.uniform('outline.outer.enabled', 'bool', undefined);
    expect(binder.uniformNode('outline.outer.enabled')?.value).toBe(1);
    binder.apply({
      ...s,
      outline: {...s.outline, outer: {...s.outline.outer, enabled: false}},
    });
    expect(binder.uniformNode('outline.outer.enabled')?.value).toBe(0);
  });

  it('AC-PIX-034.1 (unit): 100 rim strength changes rebuild no node material', () => {
    const base = defaultRenderSettings();
    const binder = new SettingsBinder(base);
    const rim = binder.uniform('rim.strength', 'float', undefined);
    const material = new MeshBasicNodeMaterial();
    material.colorNode = vec3(rim as Node<'float'>);
    const version = material.version;
    const colorNode = material.colorNode;
    let rebuilds = 0;
    for (let i = 0; i < 100; i++) {
      const diff = binder.apply(withRim(base, i / 100));
      expect(diff.changed).toEqual(['toon.rim.strength']);
      if (!isUniformOnly(diff)) rebuilds++;
      expect(binder.uniform('rim.strength', 'float', undefined)).toBe(rim);
      expect(binder.uniformNode('rim.strength')?.value).toBe(i / 100);
    }
    expect(rebuilds).toBe(0);
    expect(material.version).toBe(version);
    expect(material.colorNode).toBe(colorNode);
    material.dispose();
  });
});

describe('reserved settings binding (REQ-SGF-041, M2 built-in chain)', () => {
  const dither = (strength: number, base: RenderSettings) => ({
    ...base,
    palette: {...base.palette, dither: {mode: 'bayer4' as const, strength}},
  });

  it('AC-SGF-041.2: dither.strength 0.5 -> 0.8 updates the keyed uniform in place, needs no recompile, and adds no params key', () => {
    const base = dither(0.5, defaultRenderSettings());
    const binder = new SettingsBinder(base);
    const node = binder.uniform('dither.strength', 'float', undefined);
    const valueOf = () => binder.uniformNode('dither.strength')?.value;
    expect(valueOf()).toBe(0.5);
    const next = dither(0.8, base);
    const diff = binder.apply(next);
    expect(diff.changed).toEqual(['palette.dither.strength']);
    expect(isUniformOnly(diff)).toBe(true); // no post/material rebuild
    expect(binder.uniform('dither.strength', 'float', undefined)).toBe(node);
    expect(valueOf()).toBeCloseTo(0.8, 6);
    expect(Object.keys(next.params)).not.toContain('dither.strength');
  });

  it('REQ-SGF-041 (engine half of the inner colour mode binding): outline fields are black/darken by default; inner.colorMode changes rebuild the post chain, not uniforms, and add no params key', () => {
    const base = defaultRenderSettings();
    expect(outlineFieldsFromSettings(base.outline)).toEqual({
      mode: 'black',
      innerMode: 'darken',
    });
    const next = {
      ...base,
      outline: {
        ...base.outline,
        inner: {...base.outline.inner, colorMode: 'black' as const},
      },
    };
    expect(outlineFieldsFromSettings(next.outline)).toEqual({
      mode: 'black',
      innerMode: 'black',
    });
    const diff = diffRenderSettings(base, next);
    expect(diff.post).toBe(true);
    expect(isUniformOnly(diff)).toBe(false);
    expect(Object.keys(next.params)).not.toContain('outline.inner.colorMode');
  });

  it('REQ-SGF-041: RESERVED_NON_UNIFORM_IDS lists outline.inner.colorMode (spec 007 reserved table, field binding)', () => {
    expect(RESERVED_NON_UNIFORM_IDS).toContain('outline.inner.colorMode');
  });
});

describe('diffRenderSettings (REQ-PIX-034, m2-plan 2.7)', () => {
  const base = defaultRenderSettings('three-quarter');

  it('has an explicit rule for every settings leaf (no conservative fallback)', () => {
    const full = settings({
      camera: {preset: 'custom'},
      toon: {thresholds: [0.3, 0.6]},
      outline: {color: '#102030'},
      palette: {id: 'custom', colors: ['#ffffff']},
    });
    for (const path of leafPaths(full)) {
      const d = diffRenderSettings(full, setLeaf(full, path));
      expect({path, fallback: d.post && d.material}).toEqual({
        path,
        fallback: false,
      });
    }
  });

  it('AC-PIX-034.2: postStructureKey changes exactly when diff.post is set, for every settings leaf', () => {
    const full = settings({
      camera: {preset: 'custom'},
      toon: {thresholds: [0.3, 0.6]},
      outline: {color: '#102030'},
      palette: {id: 'custom', colors: ['#ffffff']},
    });
    const key = postStructureKey(full);
    expect(postStructureKey(structuredClone(full))).toBe(key);
    for (const path of leafPaths(full)) {
      const next = setLeaf(full, path);
      expect({
        path,
        keyChanged: postStructureKey(next) !== key,
      }).toEqual({path, keyChanged: diffRenderSettings(full, next).post});
    }
    const none = {...full, palette: {...full.palette, id: 'none' as const}};
    expect(diffRenderSettings(full, none).post).toBe(true);
    expect(postStructureKey(none)).not.toBe(key);
  });

  it('classifies uniform-only changes', () => {
    const cases: RenderSettings[] = [
      {...base, lighting: {...base.lighting, azimuthDeg: 10}},
      {...base, toon: {...base.toon, bands: 4}},
      {...base, toon: {...base.toon, thresholds: [0.2, 0.4]}},
      withRim(base, 0.9),
      {...base, outline: {...base.outline, darkenAmount: 0.2}},
      {...base, outline: {...base.outline, color: '#ff0000'}},
      {
        ...base,
        outline: {
          ...base.outline,
          inner: {...base.outline.inner, depthThresholdPx: 2},
        },
      },
      {
        ...base,
        palette: {...base.palette, dither: {mode: 'none', strength: 0.1}},
      },
      {...base, alphaCutoff: 0.3},
      {...base, params: {glow: 1}},
    ];
    for (const next of cases) {
      const d = diffRenderSettings(base, next);
      expect(d.uniforms).toBe(true);
      expect(isUniformOnly(d)).toBe(true);
    }
  });

  it('re-uploads the LUT without recompiling for palette color changes', () => {
    const a = settings({palette: {id: 'custom', colors: ['#ffffff']}});
    const b = settings({palette: {id: 'custom', colors: ['#000000']}});
    const d = diffRenderSettings(a, b);
    expect(d.palette).toBe(true);
    expect(isUniformOnly(d)).toBe(true);
    const e = diffRenderSettings(
      settings({palette: {id: 'pico-8'}}),
      settings({palette: {id: 'endesga-32'}}),
    );
    expect(e.palette && isUniformOnly(e)).toBe(true);
  });

  it('classifies structural changes', () => {
    const post = (next: RenderSettings) =>
      expect(diffRenderSettings(base, next).post).toBe(true);
    post({
      ...base,
      palette: {...base.palette, dither: {mode: 'bayer4', strength: 0.5}},
    });
    post({
      ...base,
      outline: {...base.outline, inner: {...base.outline.inner, depth: true}},
    });
    post({...base, outline: {...base.outline, colorMode: 'darken'}});
    post({
      ...base,
      outline: {
        ...base.outline,
        inner: {...base.outline.inner, colorMode: 'black'},
      },
    });
    post({...base, palette: {...base.palette, id: 'pico-8'}});
    post({...base, postGraph: 'user:x'});
    expect(
      diffRenderSettings(base, {...base, materialGraph: 'user:m'}).material,
    ).toBe(true);
    const resize = diffRenderSettings(base, {
      ...base,
      resolution: {width: 32, height: 32},
    });
    expect(resize.resize && resize.reframe).toBe(true);
    for (const next of [
      {...base, camera: {...base.camera, pivotRowPx: 9}},
      {...base, directions: 4 as const},
      {...base, singleFacing: 'n' as const},
      {
        ...base,
        outline: {...base.outline, outer: {enabled: true, widthPx: 3 as const}},
      },
    ]) {
      expect(diffRenderSettings(base, next).reframe).toBe(true);
    }
  });

  it('reports nothing for equal settings and everything for the first apply', () => {
    const same = diffRenderSettings(
      base,
      defaultRenderSettings('three-quarter'),
    );
    expect(same.changed).toEqual([]);
    expect(isUniformOnly(same) && !same.uniforms && !same.palette).toBe(true);
    const first = diffRenderSettings(undefined, base);
    expect(first.post && first.material && first.resize && first.reframe).toBe(
      true,
    );
  });
});

describe('settings binder: palette builtins', () => {
  const linear = (hex: string) =>
    [1, 3, 5].map(i => srgb8ToLinear(parseInt(hex.slice(i, i + 2), 16)));

  it('AC-PIX-017.4 (builtin): render.paletteDarkest is linear black for palette none', () => {
    const binder = new SettingsBinder(defaultRenderSettings());
    expect(binder.paletteDarkest.value.toArray()).toEqual([0, 0, 0]);
    expect(binder.paletteEnabledValue.value).toBe(0);
    expect(binder.paletteReady).toBe(true);
  });

  it('AC-SGF-043.1: darkest and enabled follow the palette without recompiling', () => {
    const binder = new SettingsBinder(settings({palette: {id: 'endesga-32'}}));
    expect(binder.paletteDarkest.value.toArray()).toEqual(linear('#181425'));
    expect(binder.paletteEnabledValue.value).toBe(1);
    const node = binder.paletteLutNode();

    const diff = binder.apply(settings({palette: {id: 'pico-8'}}));
    expect(diff.palette && isUniformOnly(diff)).toBe(true);
    expect(binder.paletteDarkest.value.toArray()).toEqual([0, 0, 0]);
    expect(binder.paletteEnabledValue.value).toBe(1);
    expect(binder.paletteLutNode()).toBe(node);

    const custom = binder.apply(
      settings({palette: {id: 'custom', colors: ['#ffffff', '#102030']}}),
    );
    expect(isUniformOnly(custom)).toBe(true);
    expect(binder.paletteDarkest.value.toArray()).toEqual(linear('#102030'));

    const off = binder.apply(defaultRenderSettings());
    expect(off.post).toBe(true);
    expect(binder.paletteEnabledValue.value).toBe(0);
    expect(binder.paletteDarkest.value.toArray()).toEqual([0, 0, 0]);
  });

  it('re-uploads the LUT into one reused texture; not ready until uploaded', () => {
    const binder = new SettingsBinder(settings({palette: {id: 'endesga-32'}}));
    expect(binder.paletteReady).toBe(false);
    const node = binder.paletteLutNode();
    const tex = node.value as DataTexture;
    binder.setPaletteLut(new Uint8Array(PALETTE_LUT_BYTES).fill(7));
    expect(binder.paletteReady).toBe(true);
    expect((tex.image.data as Uint8Array)[0]).toBe(7);
    const v = tex.version;

    binder.apply(settings({palette: {id: 'pico-8'}}));
    expect(binder.paletteReady).toBe(false);
    binder.setPaletteLut(new Uint8Array(PALETTE_LUT_BYTES));
    expect(binder.paletteLutNode()).toBe(node);
    expect(node.value).toBe(tex);
    expect(tex.version).toBeGreaterThan(v);
    // Same palette, other dither strength: the LUT stays valid.
    binder.apply(settings({palette: {id: 'pico-8', dither: {strength: 0.1}}}));
    expect(binder.paletteReady).toBe(true);
    expect(() => binder.setPaletteLut(new Uint8Array(4))).toThrow(/bytes/);
    binder.dispose();
  });

  it('lists the active palette colors for the LUT builder', () => {
    expect(activePaletteColors(defaultRenderSettings().palette)).toBeNull();
    expect(
      activePaletteColors(settings({palette: {id: 'pico-8'}}).palette)?.length,
    ).toBe(16);
    expect(
      activePaletteColors(
        settings({palette: {id: 'custom', colors: ['#123456']}}).palette,
      ),
    ).toEqual(['#123456']);
  });

  it('reports the dither matrix size, 0 without a palette (AC-PIX-022.3)', () => {
    const dither = {mode: 'bayer4', strength: 0.5};
    expect(
      new SettingsBinder(settings({palette: {id: 'none', dither}}))
        .ditherMatrixSize,
    ).toBe(0);
    expect(
      new SettingsBinder(settings({palette: {id: 'pico-8', dither}}))
        .ditherMatrixSize,
    ).toBe(4);
  });
});

/** Returns `s` with the leaf at `path` changed to a different valid-shaped value. */
function setLeaf(s: RenderSettings, path: string): RenderSettings {
  const copy = structuredClone(s) as unknown as Record<string, unknown>;
  const keys = path.split('.');
  let obj = copy;
  for (const k of keys.slice(0, -1)) obj = obj[k] as Record<string, unknown>;
  const last = keys[keys.length - 1] as string;
  const old = obj[last];
  obj[last] =
    typeof old === 'number'
      ? old + 1
      : typeof old === 'boolean'
        ? !old
        : Array.isArray(old)
          ? [...(old as unknown[]), 'x']
          : `${String(old)}-changed`;
  return copy as unknown as RenderSettings;
}
