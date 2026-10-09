import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {
  dedupeColors,
  hexToRgb,
  PALETTE_PRESETS,
  PALETTE_PRESET_IDS,
  parsePaletteData,
  rgbToHex,
} from './palettes';

// Spec 003 Data & contracts, verified against the Lospec downloads (2026-10-08).
const PICO8 = [
  '#000000',
  '#1d2b53',
  '#7e2553',
  '#008751',
  '#ab5236',
  '#5f574f',
  '#c2c3c7',
  '#fff1e8',
  '#ff004d',
  '#ffa300',
  '#ffec27',
  '#00e436',
  '#29adff',
  '#83769c',
  '#ff77a8',
  '#ffccaa',
];
const ENDESGA32 = [
  '#be4a2f',
  '#d77643',
  '#ead4aa',
  '#e4a672',
  '#b86f50',
  '#733e39',
  '#3e2731',
  '#a22633',
  '#e43b44',
  '#f77622',
  '#feae34',
  '#fee761',
  '#63c74d',
  '#3e8948',
  '#265c42',
  '#193c3e',
  '#124e89',
  '#0099db',
  '#2ce8f5',
  '#ffffff',
  '#c0cbdc',
  '#8b9bb4',
  '#5a6988',
  '#3a4466',
  '#262b44',
  '#181425',
  '#ff0044',
  '#68386c',
  '#b55088',
  '#f6757a',
  '#e8b796',
  '#c28569',
];

function dataFile(id: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../data/palettes/${id}.json`, import.meta.url),
      'utf8',
    ),
  );
}

describe('palette data files', () => {
  it('AC-PIX-018.1: pico-8 data file lists exactly the 16 spec colors in order', () => {
    const file = dataFile('pico-8') as {colors: string[]};
    expect(file.colors).toEqual(PICO8);
    expect(PALETTE_PRESETS['pico-8'].colors).toEqual(PICO8);
  });

  it('AC-PIX-020.1: endesga-32 data file lists exactly the 32 spec colors in order', () => {
    const file = dataFile('endesga-32') as {colors: string[]};
    expect(file.colors).toEqual(ENDESGA32);
    expect(PALETTE_PRESETS['endesga-32'].colors).toEqual(ENDESGA32);
  });

  it('REQ-PIX-018: every preset file validates and records its source (P-02)', () => {
    for (const id of PALETTE_PRESET_IDS) {
      const result = parsePaletteData(dataFile(id));
      expect(result.ok).toBe(true);
      expect(PALETTE_PRESETS[id].id).toBe(id);
      expect(PALETTE_PRESETS[id].source.note).toBe(
        'color list, no license stated by source',
      );
    }
  });

  it('REQ-PIX-018: a palette file with more than 256 colors is rejected', () => {
    const file = dataFile('pico-8') as {colors: string[]};
    const colors = Array.from({length: 257}, (_, i) =>
      rgbToHex(i % 256, i >> 8, 0),
    );
    expect(parsePaletteData({...file, colors}).ok).toBe(false);
  });
});

describe('palette helpers', () => {
  it('parses and formats hex colors', () => {
    expect(hexToRgb('#FF004D')).toEqual([255, 0, 77]);
    expect(hexToRgb('ff004d')).toBeNull();
    expect(rgbToHex(255, 0, 77)).toBe('#ff004d');
  });

  it('AC-PIX-019.2: dedupe is case-insensitive and keeps the first occurrence', () => {
    expect(dedupeColors(['#ff0000', '#FF0000', '#00ff00'])).toEqual({
      kept: ['#ff0000', '#00ff00'],
      removed: ['#FF0000'],
    });
  });
});
