/**
 * Golden matrix, fixture character (M2-18, REQ-PIX-028): side, three-quarter and isometric at
 * 32, 64 and 128 px, 8 directions. The 64 px strips have 2 frames (rows), 32 and 128 px one.
 * Runs on both backends (AC-PIX-026.1, AC-PIX-028.1); tolerance 0.
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
import type {Preset} from './golden-stage';

const PRESETS: readonly Preset[] = ['side', 'three-quarter', 'isometric'];
const SIZES = [32, 64, 128] as const;

describe(`golden: fixture character (${currentBackend()})`, () => {
  let h: GpuHarness;
  let binder: SettingsBinder;
  let stage: RealStage;
  beforeAll(async () => {
    h = await createGpuHarness(64, 64);
    binder = new SettingsBinder();
    stage = await loadFixtureStage(binder, h.backend);
  });
  afterAll(() => {
    stage?.dispose();
    binder?.dispose();
    h?.dispose();
  });

  for (const preset of PRESETS) {
    for (const size of SIZES) {
      it(
        `AC-PIX-028.1, AC-PIX-026.1: fixture ${preset} ${size} px matches the golden`,
        {timeout: 120_000},
        async () => {
          await goldenCase(
            h,
            stage,
            binder,
            `fixture-${preset}-${size}`,
            goldenSettings({
              preset,
              size,
              clipId: FIXTURE_CLIP,
              frames: size === 64 ? 2 : 1,
            }),
          );
        },
      );
    }
  }
});
