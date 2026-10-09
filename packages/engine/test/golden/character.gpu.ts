/**
 * Golden cases of the default Quaternius character (M2-18, REQ-PIX-028): three-quarter at 64 px
 * in the default look and in pico-8 + bayer4 (8 directions x 2 walk frames), plus 32 and 128 px.
 * Both backends, tolerance 0 (AC-PIX-028.1, AC-PIX-026.1).
 */
import {DEFAULT_CHARACTER_DATA} from '@csg/parts-schema';
import {afterAll, beforeAll, describe, it} from 'vitest';
import {SettingsBinder} from '../../src/pipeline/settings-binder';
import {createGpuHarness, currentBackend} from '../gpu/harness';
import type {GpuHarness} from '../gpu/harness';
import {loadDefaultCharacter} from '../gpu/real-character';
import type {RealStage} from '../gpu/real-character';
import {goldenCase, goldenSettings} from './golden-stage';

const WALK = DEFAULT_CHARACTER_DATA.clips[1] as string;

const CASES = [
  {name: 'quaternius-three-quarter-64', size: 64, frames: 2, pico8: false},
  {name: 'quaternius-three-quarter-64-pico8', size: 64, frames: 2, pico8: true},
  {name: 'quaternius-three-quarter-32', size: 32, frames: 1, pico8: false},
  {name: 'quaternius-three-quarter-128', size: 128, frames: 1, pico8: false},
] as const;

describe(`golden: default Quaternius character (${currentBackend()})`, () => {
  let h: GpuHarness;
  let binder: SettingsBinder;
  let stage: RealStage;
  beforeAll(async () => {
    h = await createGpuHarness(64, 64);
    binder = new SettingsBinder();
    stage = await loadDefaultCharacter(binder, h.backend);
  });
  afterAll(() => {
    stage?.dispose();
    binder?.dispose();
    h?.dispose();
  });

  for (const c of CASES) {
    it(
      `AC-PIX-028.1, AC-PIX-026.1: ${c.name} matches the golden`,
      {timeout: 180_000},
      async () => {
        await goldenCase(
          h,
          stage,
          binder,
          c.name,
          goldenSettings({
            preset: 'three-quarter',
            size: c.size,
            clipId: WALK,
            frames: c.frames,
            pico8: c.pico8,
          }),
        );
      },
    );
  }
});
