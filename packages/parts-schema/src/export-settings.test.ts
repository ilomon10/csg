import {describe, expect, it} from 'vitest';
import {defaultExportSettings, parseExportSettings} from './export-settings';

describe('ExportSettings', () => {
  it('REQ-EXP-003: defaults are grid-by-animation, clip-major, scale 1, aseprite-json', () => {
    expect(defaultExportSettings()).toMatchObject({
      layout: 'grid-by-animation',
      rowOrder: 'clip-major',
      maxColumns: null,
      scales: [1],
      paddingPx: 0,
      marginPx: 0,
      metadata: 'aseprite-json',
      pngColorType: 'rgba',
      enginePreset: 'none',
      previews: {gif: false, apng: false, scale: 2},
      includeCredits: true,
    });
  });

  it('AC-EXP-009.2: empty, duplicate, descending or unknown scales fail with EXP_INVALID_SETTINGS', () => {
    for (const scales of [[], [1, 1], [2, 1], [3]]) {
      const result = parseExportSettings({scales});
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('EXP_INVALID_SETTINGS');
        expect(result.issues[0]?.path.startsWith('scales')).toBe(true);
      }
    }
    expect(parseExportSettings({scales: [1, 2, 8]}).ok).toBe(true);
  });

  it('AC-EXP-008.1: extrude 2 with padding 2 fails, extrude 1 with padding 2 passes', () => {
    expect(parseExportSettings({extrudePx: 1, paddingPx: 2}).ok).toBe(true);
    const bad = parseExportSettings({extrudePx: 2, paddingPx: 2});
    expect(bad.ok === false && bad.issues[0]?.path).toBe('paddingPx');
  });

  it('REQ-EXP-006: padding and margin are limited to 0..16, maxColumns to 1..256', () => {
    expect(parseExportSettings({paddingPx: 17}).ok).toBe(false);
    expect(parseExportSettings({marginPx: -1}).ok).toBe(false);
    expect(parseExportSettings({maxColumns: 0}).ok).toBe(false);
    expect(parseExportSettings({maxColumns: 256}).ok).toBe(true);
  });

  it('AC-EXP-020.2 / REQ-EXP-020: includeCredits cannot be switched off (hand-edited false fails, true and absent pass)', () => {
    expect(parseExportSettings({includeCredits: false}).ok).toBe(false);
    expect(parseExportSettings({includeCredits: true}).ok).toBe(true);
    expect(parseExportSettings({}).ok).toBe(true);
  });

  it('REQ-LIT-020: maps are optional and validated', () => {
    expect(defaultExportSettings().maps).toBeUndefined();
    expect(parseExportSettings({maps: {normal: true}}).ok).toBe(true);
    expect(parseExportSettings({maps: {quantizeNormals: 4}}).ok).toBe(false);
  });
});
