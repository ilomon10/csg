/**
 * Look preset goldens (M3-17, spec 006 REQ-EDT-044, AC-EDT-044.2): each shipped look preset of
 * `assets/packs/quaternius-ubc/presets/looks` applied to the default render settings, rendered on
 * the default character at 64 px with the side camera (idle frame 0, 8 directions), both backends,
 * tolerance 0. AC-EDT-044.1 (GameBoy palette only) is checked on the same frames.
 */
import {DEFAULT_CHARACTER_DATA} from '@csg/parts-schema';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {SettingsBinder} from '../../src/pipeline/settings-binder';
import {createGpuHarness, currentBackend} from '../gpu/harness';
import type {GpuHarness} from '../gpu/harness';
import {loadDefaultCharacter} from '../gpu/real-character';
import type {RealStage} from '../gpu/real-character';
import {goldenCase, goldenSettings} from './golden-stage';
import {LOOK_PRESET_IDS, loadLookPreset, lookFields} from './look-preset-data';

const IDLE = DEFAULT_CHARACTER_DATA.clips[0] as string;
const CELL = 64;

describe(`golden: look presets (${currentBackend()})`, () => {
  let h: GpuHarness;
  let binder: SettingsBinder;
  let stage: RealStage;
  beforeAll(async () => {
    h = await createGpuHarness(CELL, CELL);
    binder = new SettingsBinder();
    stage = await loadDefaultCharacter(binder, h.backend);
  });
  afterAll(() => {
    stage?.dispose();
    binder?.dispose();
    h?.dispose();
  });

  for (const id of LOOK_PRESET_IDS) {
    it(
      `AC-EDT-044.2: look preset ${id} (64 px, side, default character) matches its golden`,
      {timeout: 180_000},
      async () => {
        const preset = await loadLookPreset(id);
        const {frames} = await goldenCase(
          h,
          stage,
          binder,
          `look-${id}-side-64`,
          goldenSettings({
            preset: 'side',
            size: CELL,
            clipId: IDLE,
            frames: 1,
            extra: lookFields(preset),
          }),
        );
        if (id !== 'gameboy-4') return;
        // AC-EDT-044.1: every opaque pixel is one of the 4 palette colors.
        const allowed = new Set(
          (preset.palette?.colors ?? []).map(c => c.toLowerCase()),
        );
        expect(allowed.size).toBe(4);
        const outside = new Set<string>();
        for (const f of frames) {
          for (let i = 0; i < f.pixels.length; i += 4) {
            if (f.pixels[i + 3] === 0) continue;
            const hex = `#${[0, 1, 2]
              .map(k => f.pixels[i + k]!.toString(16).padStart(2, '0'))
              .join('')}`;
            if (!allowed.has(hex)) outside.add(hex);
          }
        }
        expect([...outside]).toEqual([]);
      },
    );
  }
});
