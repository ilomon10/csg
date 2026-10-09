import {describe, expect, it} from 'vitest';
import {
  defaultPivotRowPx,
  defaultRenderSettings,
  DIRECTION_ORDER,
  parseRenderSettings,
} from './render-settings';
import type {RenderSettingsIssue} from './render-settings';

function failure(input: unknown): RenderSettingsIssue[] {
  const result = parseRenderSettings(input);
  if (result.ok) throw new Error('expected failure');
  return result.issues;
}

function colors(n: number): string[] {
  return Array.from({length: n}, (_, i) => {
    const hex = (i + 1).toString(16).padStart(6, '0');
    return `#${hex}`;
  });
}

describe('render settings', () => {
  it('AC-PIX-001.1: 48x64 resolution is accepted', () => {
    const result = parseRenderSettings({resolution: {width: 48, height: 64}});
    expect(result.ok && result.value.resolution).toEqual({
      width: 48,
      height: 64,
    });
  });

  it('AC-PIX-001.2: resolutions 31, 129, 64.5 and NaN fail with PIX_INVALID_RESOLUTION', () => {
    for (const bad of [31, 129, 64.5, NaN]) {
      for (const axis of ['width', 'height']) {
        const issues = failure({
          resolution: {width: 64, height: 64, [axis]: bad},
        });
        expect(issues.map(i => i.code)).toEqual(['PIX_INVALID_RESOLUTION']);
        expect(issues[0]?.path).toBe(`resolution.${axis}`);
      }
    }
  });

  it('AC-PIX-004.2: custom elevation 91 or 12.3 fails with PIX_INVALID_CAMERA', () => {
    for (const elevationDeg of [91, 12.3]) {
      const issues = failure({camera: {preset: 'custom', elevationDeg}});
      expect(issues[0]?.code).toBe('PIX_INVALID_CAMERA');
    }
    expect(
      parseRenderSettings({camera: {preset: 'custom', elevationDeg: 12.5}}).ok,
    ).toBe(true);
  });

  it('AC-PIX-005.4: 3 or 6 directions fail with PIX_INVALID_DIRECTIONS', () => {
    for (const directions of [3, 6]) {
      expect(failure({directions})[0]?.code).toBe('PIX_INVALID_DIRECTIONS');
    }
    for (const directions of [1, 2, 4, 8]) {
      expect(parseRenderSettings({directions}).ok).toBe(true);
    }
  });

  it('AC-PIX-011.2: bands 5 or non-ascending thresholds fail with PIX_INVALID_TOON', () => {
    expect(failure({toon: {bands: 5}})[0]?.code).toBe('PIX_INVALID_TOON');
    expect(failure({toon: {bands: 3, thresholds: [0.6, 0.3]}})[0]?.code).toBe(
      'PIX_INVALID_TOON',
    );
    expect(failure({toon: {bands: 3, thresholds: [0, 0.5]}})[0]?.code).toBe(
      'PIX_INVALID_TOON',
    );
    expect(failure({toon: {bands: 3, thresholds: [0.5]}})[0]?.code).toBe(
      'PIX_INVALID_TOON',
    );
    expect(
      parseRenderSettings({toon: {bands: 3, thresholds: [0.3, 0.6]}}).ok,
    ).toBe(true);
  });

  it('AC-PIX-019.1: 257 colors fail with PIX_PALETTE_TOO_LARGE; 256 pass', () => {
    const issues = failure({palette: {id: 'custom', colors: colors(257)}});
    expect(issues.map(i => i.code)).toEqual(['PIX_PALETTE_TOO_LARGE']);
    expect(
      parseRenderSettings({palette: {id: 'custom', colors: colors(256)}}).ok,
    ).toBe(true);
  });

  it('AC-PIX-019.2: duplicates are dropped with a PIX_PALETTE_DUPLICATES warning', () => {
    const result = parseRenderSettings({
      palette: {id: 'custom', colors: ['#ff0000', '#FF0000', '#00ff00']},
    });
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.palette.colors).toEqual(['#ff0000', '#00ff00']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      code: 'PIX_PALETTE_DUPLICATES',
      removed: ['#FF0000'],
    });
  });

  it('REQ-PIX-019: a custom palette needs colors; custom outline needs a color', () => {
    expect(failure({palette: {id: 'custom'}})[0]?.code).toBe(
      'PIX_PALETTE_PARSE',
    );
    expect(failure({palette: {id: 'custom', colors: []}})[0]?.code).toBe(
      'PIX_PALETTE_PARSE',
    );
    expect(failure({outline: {colorMode: 'custom'}})[0]?.path).toBe(
      'outline.color',
    );
  });

  it('AC-PIX-037.1: an invalid resolution and an invalid palette list both errors with paths', () => {
    const issues = failure({
      resolution: {width: 10, height: 64},
      palette: {id: 'nope'},
    });
    expect(issues.map(i => [i.path, i.code])).toEqual([
      ['resolution.width', 'PIX_INVALID_RESOLUTION'],
      ['palette.id', 'PIX_PALETTE_PARSE'],
    ]);
  });

  it('AC-PIX-037.2: omitted lighting, toon and outline get the defaults', () => {
    const result = parseRenderSettings({
      resolution: {width: 64, height: 64},
      camera: {preset: 'side'},
    });
    if (!result.ok) throw new Error('expected ok');
    const v = result.value;
    expect(v.lighting).toEqual({
      azimuthDeg: 135,
      elevationDeg: 45,
      ambient: 0.1,
    });
    expect(v.toon).toEqual({
      bands: 3,
      rim: {enabled: true, strength: 0.5},
    });
    expect(v.outline).toEqual({
      outer: {enabled: true, widthPx: 1},
      inner: {
        enabled: true,
        partId: true,
        depth: false,
        normal: false,
        depthThresholdPx: 4,
        normalThresholdDeg: 60,
        colorMode: 'darken',
      },
      colorMode: 'black',
      darkenAmount: 0.6,
    });
    expect(v.palette).toEqual({
      id: 'none',
      metric: 'oklab',
      dither: {mode: 'none', strength: 0.5},
    });
    expect(v.alphaCutoff).toBe(0.5);
    expect(v.mirrorWest).toBe(false);
    expect(v.materialGraph).toBe('builtin:material-toon');
    expect(v.postGraph).toBe('builtin:post-default');
  });

  it('REQ-PIX-037: defaults per camera preset follow the spec 003 table', () => {
    const pick = (preset: 'side' | 'three-quarter' | 'isometric') => {
      const v = defaultRenderSettings(preset);
      return [
        v.resolution,
        v.directions,
        v.singleFacing,
        v.camera.pivotRowPx,
        v.camera.framing,
        v.camera.elevationDeg,
      ];
    };
    const r = {width: 64, height: 64};
    expect(pick('side')).toEqual([r, 2, 'e', 3, 'auto', 0]);
    expect(pick('three-quarter')).toEqual([r, 8, 's', 12, 'auto', 35]);
    expect(pick('isometric')).toEqual([r, 8, 's', 10, 'auto', 30]);
  });

  it('AC-PIX-008.5: resolution-relative pivotRowPx defaults; explicit values override', () => {
    const pivot = (input: unknown) => {
      const result = parseRenderSettings(input);
      if (!result.ok) throw new Error('expected ok');
      return result.value.camera.pivotRowPx;
    };
    const at = (preset: string, h: number, outline?: unknown) =>
      pivot({
        resolution: {width: h, height: h},
        camera: {preset},
        ...(outline === undefined ? {} : {outline: {outer: outline}}),
      });
    const heights = [32, 64, 128];
    expect(heights.map(h => at('side', h))).toEqual([3, 3, 3]);
    expect(heights.map(h => at('three-quarter', h))).toEqual([6, 12, 24]);
    expect(heights.map(h => at('isometric', h))).toEqual([5, 10, 20]);
    expect(heights.map(h => at('custom', h))).toEqual([6, 12, 24]);
    expect(heights.map(h => at('side', h, {enabled: false}))).toEqual([
      2, 2, 2,
    ]);
    expect(at('side', 64, {widthPx: 3})).toBe(5);
    expect(
      pivot({
        resolution: {width: 64, height: 40},
        camera: {preset: 'three-quarter'},
      }),
    ).toBe(8);
    expect(pivot({camera: {preset: 'isometric', pivotRowPx: 4}})).toBe(4);
    expect(defaultPivotRowPx('three-quarter', 40, 1)).toBe(8);
  });

  it('AC-PIX-004.3: custom preset with every other field omitted gets the three-quarter values; side ignores elevation 91', () => {
    const custom = parseRenderSettings({camera: {preset: 'custom'}});
    if (!custom.ok) throw new Error('expected ok');
    expect([
      custom.value.camera.elevationDeg,
      custom.value.directions,
      custom.value.singleFacing,
      custom.value.camera.pivotRowPx,
    ]).toEqual([35, 8, 's', 12]);
    const side = parseRenderSettings({
      camera: {preset: 'side', elevationDeg: 91},
    });
    expect(side.ok).toBe(true);
  });

  it('FX-J: inner and outer outline colour modes are separate; custom in either needs outline.color', () => {
    const v = defaultRenderSettings();
    expect([v.outline.colorMode, v.outline.inner.colorMode]).toEqual([
      'black',
      'darken',
    ]);
    expect(failure({outline: {inner: {colorMode: 'custom'}}})[0]?.path).toBe(
      'outline.color',
    );
    // Deprecated rim width still loads (0..1) and is range-checked.
    expect(parseRenderSettings({toon: {rim: {width: 0.3}}}).ok).toBe(true);
    expect(parseRenderSettings({toon: {rim: {width: 2}}}).ok).toBe(false);
  });

  it('REQ-PIX-037: explicit values override preset defaults; pivot row is bounded by height', () => {
    const result = parseRenderSettings({
      camera: {preset: 'isometric', pivotRowPx: 10},
      directions: 4,
    });
    expect(
      result.ok && [result.value.directions, result.value.camera.pivotRowPx],
    ).toEqual([4, 10]);
    expect(failure({camera: {pivotRowPx: 64}})[0]?.code).toBe(
      'PIX_INVALID_CAMERA',
    );
  });

  it('REQ-PIX-005: DIRECTION_ORDER is counter-clockwise from screen-right', () => {
    expect(DIRECTION_ORDER).toEqual([
      'e',
      'ne',
      'n',
      'nw',
      'w',
      'sw',
      's',
      'se',
    ]);
  });

  it('REQ-PIX-037: range checks on lighting, outline and alpha cutoff', () => {
    expect(failure({alphaCutoff: 0}).length).toBe(1);
    expect(failure({lighting: {elevationDeg: 91}}).length).toBe(1);
    expect(failure({outline: {inner: {normalThresholdDeg: 0}}}).length).toBe(1);
    expect(failure({outline: {outer: {widthPx: 4}}}).length).toBe(1);
    expect(failure({palette: {dither: {mode: 'bayer3'}}}).length).toBe(1);
  });
});
