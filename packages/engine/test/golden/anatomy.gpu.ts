/**
 * Anatomy golden cases (M2-18, spec 002): AC-ANA-001.3 (default anatomy is pixel-exact the
 * unmodified body), AC-ANA-006.1 (torsoWidth 1.3 keeps the torso part and the body together),
 * AC-ANA-008.1 (legLength 0.7 + feet 1.5 keeps the feet pivot row) and the min/max extremes.
 * Idle frame 0 stands in for the bind pose. Both backends, tolerance 0 for the goldens.
 */
import {DEFAULT_CHARACTER_DATA, defaultAnatomy} from '@csg/parts-schema';
import type {AnatomyParams} from '@csg/parts-schema';
import {commands} from 'vitest/browser';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {RenderedFrame} from '../../src/contracts/pipeline';
import {SettingsBinder} from '../../src/pipeline/settings-binder';
import {createGpuHarness, currentBackend} from '../gpu/harness';
import type {GpuHarness} from '../gpu/harness';
import {loadDefaultCharacter} from '../gpu/real-character';
import type {RealStage} from '../gpu/real-character';
import {goldenCase, goldenSettings, renderAll} from './golden-stage';
import type {Preset} from './golden-stage';

const IDLE = DEFAULT_CHARACTER_DATA.clips[0] as string;
const CHARACTER = DEFAULT_CHARACTER_DATA.character;
const CELL = 64;

function anatomy(overrides: Partial<AnatomyParams>): AnatomyParams {
  return {...defaultAnatomy(), ...overrides};
}

function idleSettings(preset: Preset) {
  return goldenSettings({preset, size: CELL, clipId: IDLE, frames: 1});
}

/** Rows from the bottom edge to the lowest opaque pixel of a frame (-1 when empty). */
function rowsBelowFeet(f: RenderedFrame): number {
  for (let y = CELL - 1; y >= 0; y--) {
    for (let x = 0; x < CELL; x++) {
      if (f.pixels[(y * CELL + x) * 4 + 3] !== 0) return CELL - 1 - y;
    }
  }
  return -1;
}

/** Transparent pixels enclosed by opaque ones (not 4-connected to the border). */
function enclosedHoles(frames: readonly RenderedFrame[]): number {
  let holes = 0;
  for (const f of frames) {
    const seen = new Uint8Array(CELL * CELL);
    const stack: number[] = [];
    const push = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= CELL || y >= CELL) return;
      const i = y * CELL + x;
      if (seen[i] === 1 || f.pixels[i * 4 + 3] !== 0) return;
      seen[i] = 1;
      stack.push(i);
    };
    for (let k = 0; k < CELL; k++) {
      push(k, 0);
      push(k, CELL - 1);
      push(0, k);
      push(CELL - 1, k);
    }
    while (stack.length > 0) {
      const i = stack.pop() as number;
      const x = i % CELL;
      const y = (i - x) / CELL;
      push(x + 1, y);
      push(x - 1, y);
      push(x, y + 1);
      push(x, y - 1);
    }
    for (let i = 0; i < CELL * CELL; i++) {
      if (seen[i] === 0 && f.pixels[i * 4 + 3] === 0) holes++;
    }
  }
  return holes;
}

describe(`golden: anatomy (${currentBackend()})`, () => {
  let h: GpuHarness;
  let binder: SettingsBinder;
  let stage: RealStage;
  const report: Record<string, unknown> = {};

  const setCharacter = async (
    a: AnatomyParams,
    parts: typeof CHARACTER.parts = CHARACTER.parts,
  ) => {
    const r = await stage.assembly.setCharacter({
      ...CHARACTER,
      parts,
      anatomy: a,
    } as typeof CHARACTER);
    if (!r.ok) throw new Error(r.error.message);
  };

  beforeAll(async () => {
    h = await createGpuHarness(CELL, CELL);
    binder = new SettingsBinder();
    stage = await loadDefaultCharacter(binder, h.backend);
  });
  afterAll(async () => {
    stage?.dispose();
    binder?.dispose();
    await commands.csgWriteReport(`golden-anatomy-${h.backend}.json`, report);
    h?.dispose();
  });

  it(
    'AC-ANA-001.3: the default anatomy renders the unmodified body (golden) and survives a change and reset pixel-exactly',
    {timeout: 180_000},
    async () => {
      await setCharacter(defaultAnatomy(), {});
      const settings = idleSettings('three-quarter');
      const base = await goldenCase(
        h,
        stage,
        binder,
        'anatomy-default-body-three-quarter-64',
        settings,
      );
      await setCharacter(anatomy({height: 1.2, head: 1.5}), {});
      const changed = await renderAll(h, stage, binder, settings);
      expect(Array.from(changed.frames[0]!.pixels)).not.toEqual(
        Array.from(base.frames[0]!.pixels),
      );
      await setCharacter(defaultAnatomy(), {});
      const reset = await renderAll(h, stage, binder, settings);
      reset.frames.forEach((f, i) => {
        expect(Array.from(f.pixels)).toEqual(
          Array.from(base.frames[i]!.pixels),
        );
      });
    },
  );

  it(
    'AC-ANA-006.1: torsoWidth 1.3 with the torso part leaves no more enclosed holes than torsoWidth 1 (golden)',
    {timeout: 180_000},
    async () => {
      const settings = idleSettings('three-quarter');
      await setCharacter(defaultAnatomy());
      const one = await renderAll(h, stage, binder, settings);
      await setCharacter(anatomy({torsoWidth: 1.3}));
      const wide = await goldenCase(
        h,
        stage,
        binder,
        'anatomy-torso-width-1-3-three-quarter-64',
        settings,
      );
      const holesOne = enclosedHoles(one.frames);
      const holesWide = enclosedHoles(wide.frames);
      report['torso-holes'] = {torsoWidth1: holesOne, torsoWidth1_3: holesWide};
      console.log(
        `[m2-18] ${h.backend} enclosed holes: torsoWidth 1 ${holesOne}, 1.3 ${holesWide}`,
      );
      expect(holesWide).toBeLessThanOrEqual(holesOne);
    },
  );

  it(
    'AC-ANA-008.1: legLength 0.7 + feet 1.5 keeps the feet pivot row (golden)',
    {timeout: 180_000},
    async () => {
      const settings = idleSettings('side');
      await setCharacter(defaultAnatomy());
      const base = await renderAll(h, stage, binder, settings);
      await setCharacter(anatomy({legLength: 0.7, feet: 1.5}));
      const short = await goldenCase(
        h,
        stage,
        binder,
        'anatomy-short-legs-big-feet-side-64',
        settings,
      );
      const rowsBase = base.frames.map(rowsBelowFeet);
      const rowsShort = short.frames.map(rowsBelowFeet);
      report['feet-rows'] = {
        base: rowsBase,
        short: rowsShort,
        pivotRowPx: settings.camera.pivotRowPx,
      };
      console.log(
        `[m2-18] ${h.backend} rows below feet: base ${rowsBase.join(',')} short ${rowsShort.join(',')} pivotRowPx ${settings.camera.pivotRowPx}`,
      );
      rowsShort.forEach((rows, i) => {
        expect(rows).toBeGreaterThanOrEqual(0);
        // Same feet row as the default anatomy, within the sole-vs-joint slack (1 px).
        expect(Math.abs(rows - rowsBase[i]!)).toBeLessThanOrEqual(1);
        // And near the configured pivot row (outline ring and sole slack, 2 px).
        expect(Math.abs(rows - settings.camera.pivotRowPx)).toBeLessThanOrEqual(
          2,
        );
      });
    },
  );

  it(
    'AC-ANA-001.3 (range): maximum and minimum anatomy match their goldens',
    {timeout: 240_000},
    async () => {
      const max = anatomy({
        height: 1.25,
        head: 2,
        torsoWidth: 1.4,
        shoulders: 1.4,
        armLength: 1.25,
        legLength: 1.3,
        hands: 1.75,
        feet: 1.75,
        limbThickness: 1.75,
      });
      const min = anatomy({
        height: 0.8,
        head: 0.8,
        torsoWidth: 0.8,
        shoulders: 0.8,
        armLength: 0.75,
        legLength: 0.7,
        hands: 0.75,
        feet: 0.75,
        limbThickness: 0.75,
      });
      for (const [name, a] of [
        ['anatomy-max-three-quarter-64', max],
        ['anatomy-min-three-quarter-64', min],
      ] as const) {
        await setCharacter(a);
        await goldenCase(h, stage, binder, name, idleSettings('three-quarter'));
      }
    },
  );
});
