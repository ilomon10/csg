/**
 * Small-cell coverage goldens (FX-Q, REQ-PIX-028): one 32 px, 8-direction, one-frame strip per
 * pipeline option that the main matrix leaves at its default (dither modes, palettes, outline
 * colour and width, mirrorWest, alpha cutoff). Fixture character, three-quarter camera, both
 * backends, tolerance 0 (AC-PIX-028.1). PNGs stay tiny (256 x 32).
 */
import {afterAll, beforeAll, describe, it} from 'vitest';
import {SettingsBinder} from '../../src/pipeline/settings-binder';
import {createGpuHarness, currentBackend} from '../gpu/harness';
import type {GpuHarness} from '../gpu/harness';
import type {RealStage} from '../gpu/real-character';
import {
  FIXTURE_CLIP,
  goldenCase,
  goldenSettings,
  loadFixtureStage,
} from './golden-stage';

const dither = (mode: string) => ({
  palette: {id: 'pico-8', dither: {mode, strength: 0.5}},
});

const CASES: ReadonlyArray<{
  name: string;
  extra: Record<string, unknown>;
}> = [
  {name: 'cov-bayer2-32', extra: dither('bayer2')},
  {name: 'cov-bayer8-32', extra: dither('bayer8')},
  {name: 'cov-endesga32-32', extra: {palette: {id: 'endesga-32'}}},
  {
    name: 'cov-custom-palette-32',
    extra: {
      palette: {
        id: 'custom',
        colors: ['#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75'],
      },
    },
  },
  {
    name: 'cov-outline-darken-32',
    extra: {outline: {colorMode: 'darken', darkenAmount: 0.4}},
  },
  {
    name: 'cov-outline-custom-32',
    extra: {outline: {colorMode: 'custom', color: '#ff00aa'}},
  },
  {name: 'cov-outer-width2-32', extra: {outline: {outer: {widthPx: 2}}}},
  {name: 'cov-outer-width3-32', extra: {outline: {outer: {widthPx: 3}}}},
  {name: 'cov-mirror-west-32', extra: {mirrorWest: true}},
  {name: 'cov-alpha-cutoff-32', extra: {alphaCutoff: 0.9}},
];

describe(`golden: option coverage (${currentBackend()})`, () => {
  let h: GpuHarness;
  let binder: SettingsBinder;
  let stage: RealStage;
  beforeAll(async () => {
    h = await createGpuHarness(32, 32);
    binder = new SettingsBinder();
    stage = await loadFixtureStage(binder, h.backend);
  });
  afterAll(() => {
    stage?.dispose();
    binder?.dispose();
    h?.dispose();
  });

  for (const c of CASES) {
    it(
      `AC-PIX-028.1: ${c.name} matches the golden`,
      {timeout: 120_000},
      async () => {
        await goldenCase(
          h,
          stage,
          binder,
          c.name,
          goldenSettings({
            preset: 'three-quarter',
            size: 32,
            clipId: FIXTURE_CLIP,
            frames: 1,
            extra: c.extra,
          }),
        );
      },
    );
  }
});
