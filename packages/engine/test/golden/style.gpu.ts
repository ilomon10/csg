/**
 * Style and composition goldens (M3-17, spec 001 REQ-CMP-041..043, spec 002 REQ-ANA-013/024):
 *
 * - the `chibi`/`human` pair with the shipped `chibi` anatomy preset (REQ-CMP-042) has its own
 *   goldens (three-quarter and side, 64 px, idle frame 0, 8 directions);
 * - AC-CMP-041.3: `composition: {weight: 0.5, muscle: 0}` renders exactly the default character
 *   (the `quaternius-three-quarter-64` golden) and is kept on save;
 * - AC-CMP-043.1: `style: 'stickman'` renders exactly `realistic` (same golden), keeps the stored
 *   style and reports the fallback pair;
 * - AC-CMP-043.2: `chibi`/`monster` renders exactly `chibi`/`human` (the chibi golden).
 *
 * Both backends, tolerance 0. Pixel equality with an existing golden is checked against the
 * baseline render of the same run, which itself is compared with the golden, so a mismatching
 * variant can never rewrite a golden under `CSG_GOLDEN_UPDATE`.
 */
import {
  DEFAULT_CHARACTER_DATA,
  anatomyPresetSchema,
  canonicalCharacterJson,
} from '@csg/parts-schema';
import type {AnatomyParams, CharacterSpec} from '@csg/parts-schema';
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
const WALK = DEFAULT_CHARACTER_DATA.clips[1] as string;
const CHARACTER = DEFAULT_CHARACTER_DATA.character as CharacterSpec;
const CELL = 64;

const CHIBI_URLS = import.meta.glob(
  '../../../../assets/packs/quaternius-ubc/presets/anatomy/chibi.json',
  {query: '?url', import: 'default', eager: true},
);

async function chibiAnatomy(): Promise<AnatomyParams> {
  const url = Object.values(CHIBI_URLS)[0];
  if (url === undefined) throw new Error('chibi anatomy preset not served');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return anatomyPresetSchema.parse(await res.json()).values;
}

/** The settings of the `quaternius-three-quarter-64` golden (character.gpu.ts). */
const defaultLookSettings = () =>
  goldenSettings({
    preset: 'three-quarter',
    size: CELL,
    clipId: WALK,
    frames: 2,
  });

const chibiSettings = (preset: Preset) =>
  goldenSettings({preset, size: CELL, clipId: IDLE, frames: 1});

function expectSamePixels(
  actual: readonly RenderedFrame[],
  expected: readonly RenderedFrame[],
): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((f, i) => {
    const e = expected[i]!;
    expect([f.direction, f.frame]).toEqual([e.direction, e.frame]);
    let differing = 0;
    for (let k = 0; k < f.pixels.length; k += 4) {
      if (
        f.pixels[k] !== e.pixels[k] ||
        f.pixels[k + 1] !== e.pixels[k + 1] ||
        f.pixels[k + 2] !== e.pixels[k + 2] ||
        f.pixels[k + 3] !== e.pixels[k + 3]
      )
        differing++;
    }
    expect(differing, `frame ${i} differing pixels`).toBe(0);
  });
}

describe(`golden: styles and composition (${currentBackend()})`, () => {
  let h: GpuHarness;
  let binder: SettingsBinder;
  let stage: RealStage;

  const setCharacter = async (spec: CharacterSpec) => {
    const r = await stage.assembly.setCharacter(spec);
    if (!r.ok) throw new Error(r.error.message);
  };

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

  it(
    'AC-CMP-041.3: composition {weight: 0.5, muscle: 0} renders the default character pixel-exactly (golden) and is kept on save',
    {timeout: 240_000},
    async () => {
      await setCharacter(CHARACTER);
      const base = await goldenCase(
        h,
        stage,
        binder,
        'quaternius-three-quarter-64',
        defaultLookSettings(),
      );
      const withComposition: CharacterSpec = {
        ...CHARACTER,
        composition: {weight: 0.5, muscle: 0},
      };
      await setCharacter(withComposition);
      const composed = await renderAll(h, stage, binder, defaultLookSettings());
      expectSamePixels(composed.frames, base.frames);
      expect(JSON.parse(canonicalCharacterJson(withComposition))).toMatchObject(
        {composition: {weight: 0.5, muscle: 0}},
      );
      await setCharacter(CHARACTER);
    },
  );

  it(
    'AC-CMP-043.1: style stickman renders the realistic pixels (golden), keeps the stored style and reports the fallback',
    {timeout: 240_000},
    async () => {
      await setCharacter(CHARACTER);
      const base = await goldenCase(
        h,
        stage,
        binder,
        'quaternius-three-quarter-64',
        defaultLookSettings(),
      );
      const stickman: CharacterSpec = {...CHARACTER, style: 'stickman'};
      await setCharacter(stickman);
      expect(stage.assembly.renderPair).toEqual({
        style: 'realistic',
        species: 'human',
        fallback: true,
      });
      const fallback = await renderAll(h, stage, binder, defaultLookSettings());
      expectSamePixels(fallback.frames, base.frames);
      expect(JSON.parse(canonicalCharacterJson(stickman))).toMatchObject({
        style: 'stickman',
      });
      await setCharacter(CHARACTER);
    },
  );

  it(
    'REQ-CMP-042, AC-CMP-043.2: chibi/human with the chibi anatomy preset matches its goldens; chibi/monster falls back to chibi/human pixel-exactly',
    {timeout: 300_000},
    async () => {
      const anatomy = await chibiAnatomy();
      const chibi: CharacterSpec = {...CHARACTER, style: 'chibi', anatomy};
      await setCharacter(chibi);
      expect(stage.assembly.renderPair).toEqual({
        style: 'chibi',
        species: 'human',
        fallback: false,
      });
      const side = await goldenCase(
        h,
        stage,
        binder,
        'chibi-side-64',
        chibiSettings('side'),
      );
      const threeQuarter = await goldenCase(
        h,
        stage,
        binder,
        'chibi-three-quarter-64',
        chibiSettings('three-quarter'),
      );
      await setCharacter({...chibi, species: 'monster'});
      expect(stage.assembly.renderPair).toEqual({
        style: 'chibi',
        species: 'human',
        fallback: true,
      });
      expectSamePixels(
        (await renderAll(h, stage, binder, chibiSettings('side'))).frames,
        side.frames,
      );
      expectSamePixels(
        (await renderAll(h, stage, binder, chibiSettings('three-quarter')))
          .frames,
        threeQuarter.frames,
      );
      await setCharacter(CHARACTER);
    },
  );
});
