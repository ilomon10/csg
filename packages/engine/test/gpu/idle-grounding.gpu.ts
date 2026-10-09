/**
 * GPU test of the pivot row on the real default character (AC-PIX-008.1):
 * idle clip, side view, `pivotRowPx` 2, outline off, on both backends.
 */
import {DEFAULT_CHARACTER_DATA, defaultRenderSettings} from '@csg/parts-schema';
import type {RenderSettings} from '@csg/parts-schema';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {SettingsBinder} from '../../src/pipeline/settings-binder';
import {createGpuHarness, currentBackend} from './harness';
import type {GpuHarness} from './harness';
import {loadDefaultCharacter, runExport} from './real-character';
import type {RealStage} from './real-character';

const CELL = 64;
const PIVOT_ROW_PX = 2;
const IDLE_FRAMES = 8;

type Mutable<T> = {-readonly [K in keyof T]: Mutable<T[K]>};

describe(`pivot row on the idle clip (${currentBackend()})`, () => {
  let h: GpuHarness;
  let binder: SettingsBinder;
  let character: RealStage;
  beforeAll(async () => {
    h = await createGpuHarness(CELL, CELL);
    binder = new SettingsBinder();
    character = await loadDefaultCharacter(binder, h.backend);
  });
  afterAll(() => {
    character?.dispose();
    binder?.dispose();
    h?.dispose();
  });

  // KNOWN FAILURE (QA-E finding, AC-PIX-008.1; diagnosed in FX-G): the
  // REQ-ANA-008 joint-based grounding puts the lowest feet joint
  // (`ball_leaf_*`, rest height 0.0152 m male / 0.0148 m female) on y = 0,
  // but on the Quaternius bodies that joint sits about 2 cm above the sole
  // (rest soles -0.004..-0.0095 m before grounding). The ground offset of
  // -0.015 m plus the idle pose leaves the soles 0.024..0.031 m below the
  // ground (~0.8-1 px at 64 px), so the lowest opaque row is 1, not 2. The
  // code follows the spec; the fix needs a spec decision (REQ-ANA-008 note
  // vs AC-PIX-008.1). Switch to `it` once that lands.
  it.fails(
    'AC-PIX-008.1: side view, pivotRowPx 2: the lowest opaque feet row (outline off) is row 2 from the bottom in every idle frame',
    {timeout: 240_000},
    async () => {
      const s = structuredClone(
        defaultRenderSettings('side'),
      ) as Mutable<RenderSettings>;
      const [idle] = DEFAULT_CHARACTER_DATA.clips as [string, string];
      s.resolution = {width: CELL, height: CELL};
      s.directions = 2;
      s.camera.pivotRowPx = PIVOT_ROW_PX;
      s.outline.outer.enabled = false;
      s.outline.inner.enabled = false;
      s.animations = [
        {
          clipId: idle,
          label: 'idle',
          frameCount: IDLE_FRAMES,
          fps: 8,
          loop: true,
        },
      ];
      const {frames} = await runExport(
        h,
        character,
        binder,
        s as RenderSettings,
      );
      expect(frames).toHaveLength(2 * IDLE_FRAMES);
      const rows: number[] = [];
      for (const f of frames) {
        let bottom = -1;
        for (let y = 0; y < CELL; y++) {
          for (let x = 0; x < CELL; x++) {
            if (f.pixels[(y * CELL + x) * 4 + 3] !== 0) bottom = y;
          }
        }
        rows.push(CELL - 1 - bottom);
      }
      // Row 2 from the bottom: bottom opaque pixel row index H - 1 - 2.
      // Observed: 1 in every frame (see the note above the test).
      expect(rows).toEqual(rows.map(() => PIVOT_ROW_PX));
    },
  );
});
