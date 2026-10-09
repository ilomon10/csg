import {describe, expect, it} from 'vitest';
import {asepriteSheetSchema, exportManifestSchema} from './export-manifest';

const valid = () => ({
  format: 'sprite-export-manifest',
  version: 1,
  source: {
    projectSha256: 'a'.repeat(64),
    appVersion: '0.0.0',
    threeVersion: '0.186.0',
    backend: 'webgl2',
  },
  cell: {width: 32, height: 32},
  pivotPx: [16, 30],
  directions: ['e'],
  scales: [1],
  sheets: [{file: 'a.png', scale: 1, width: 32, height: 32}],
  clips: [
    {
      label: 'idle',
      clipId: 'idle',
      fps: 8,
      frameCount: 1,
      loop: true,
      direction: 'forward',
    },
  ],
  frames: [
    {
      name: 'idle_e_000',
      label: 'idle',
      direction: 'e',
      frame: 0,
      durationMs: 125,
      mirrored: false,
      sheet: 'a.png',
      rect: {x: 0, y: 0, w: 32, h: 32},
    },
  ],
  warnings: [{code: 'LICENSE_UNKNOWN', assets: ['x']}],
});

describe('exportManifestSchema', () => {
  it('AC-EXP-011.1: accepts a manifest of the contract shape', () => {
    expect(exportManifestSchema.safeParse(valid()).success).toBe(true);
  });

  it('AC-EXP-011.1: rejects a wrong format, a bad hash and an unknown backend', () => {
    expect(
      exportManifestSchema.safeParse({...valid(), format: 'x'}).success,
    ).toBe(false);
    const bad = valid();
    bad.source.projectSha256 = 'nope';
    expect(exportManifestSchema.safeParse(bad).success).toBe(false);
    const bad2 = valid();
    bad2.source.backend = 'webgpu2';
    expect(exportManifestSchema.safeParse(bad2).success).toBe(false);
  });
});

describe('asepriteSheetSchema', () => {
  it('AC-EXP-010.2: rejects a frame without a duration', () => {
    const rect = {x: 0, y: 0, w: 1, h: 1};
    const doc = {
      frames: [
        {
          filename: 'a',
          frame: rect,
          rotated: false,
          trimmed: false,
          spriteSourceSize: rect,
          sourceSize: {w: 1, h: 1},
        },
      ],
      meta: {
        app: 'a',
        version: '1',
        image: 'a.png',
        format: 'RGBA8888',
        size: {w: 1, h: 1},
        scale: '1',
        frameTags: [],
        layers: [],
        slices: [],
      },
    };
    expect(asepriteSheetSchema.safeParse(doc).success).toBe(false);
  });
});
