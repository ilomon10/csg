/**
 * GPU tests of the pivot row on the real default character, idle clip, side view, 64 x 64,
 * `pivotRowPx` 2, outer and inner outline off, 2 directions x 8 frames, on both backends:
 *
 * - AC-PIX-008.1: the male default character (spec 003);
 * - AC-ANA-008.8: the same for body `superhero-m` and for body `superhero-f` with every part
 *   that is then incompatible removed (spec 001 REQ-CMP-008/010), so the body's own feet show.
 *
 * These pass since the M3-05 sole-based grounding (REQ-ANA-008, `soleOffsetM`, issue #10). Before
 * it the soles sat about 0.024..0.031 m below the ground and the lowest opaque row was 1.
 */
import {
  DEFAULT_CHARACTER_DATA,
  defaultRenderSettings,
  partManifestSchema,
} from '@csg/parts-schema';
import type {CharacterSpec, PartEntry, RenderSettings} from '@csg/parts-schema';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {RenderedFrame} from '../../src/contracts/pipeline';
import {SettingsBinder} from '../../src/pipeline/settings-binder';
import {createGpuHarness, currentBackend} from './harness';
import type {GpuHarness} from './harness';
import {loadDefaultCharacter, runExport} from './real-character';
import type {RealStage} from './real-character';

const CELL = 64;
const PIVOT_ROW_PX = 2;
const IDLE_FRAMES = 8;
const CHARACTER = DEFAULT_CHARACTER_DATA.character as CharacterSpec;
const FEMALE_BODY = 'builtin:quaternius-ubc/superhero-f';

const MANIFEST_URLS = import.meta.glob(
  '../../../../assets/packs/*/manifest.json',
  {query: '?url', import: 'default', eager: true},
);

type Mutable<T> = {-readonly [K in keyof T]: Mutable<T[K]>};

/** Every part entry of the built packs, by `builtin:<pack>/<id>` ref. */
async function partEntries(): Promise<Map<string, PartEntry>> {
  const out = new Map<string, PartEntry>();
  for (const url of Object.values(MANIFEST_URLS)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const manifest = partManifestSchema.parse(await res.json());
    for (const part of manifest.parts)
      out.set(`builtin:${manifest.packId}/${part.id}`, part);
  }
  return out;
}

/** REQ-CMP-008 rules (a)..(c): compatible when the rig matches and no body / body type excludes it. */
function compatible(part: PartEntry, body: PartEntry): boolean {
  if (part.rig !== undefined && part.rig !== body.rig) return false;
  const bodies = part.bodies ?? [];
  if (bodies.length > 0 && !bodies.includes(body.id)) return false;
  const types = part.bodyTypes ?? [];
  if (
    types.length > 0 &&
    (body.bodyType === undefined || !types.includes(body.bodyType))
  )
    return false;
  return true;
}

/** The default character on `bodyRef`, every part incompatible with that body removed. */
async function onBody(bodyRef: string): Promise<CharacterSpec> {
  const entries = await partEntries();
  const body = entries.get(bodyRef);
  if (body === undefined) throw new Error(`${bodyRef} not in the packs`);
  const parts: Mutable<CharacterSpec['parts']> = {};
  for (const [slot, selection] of Object.entries(CHARACTER.parts)) {
    const entry = entries.get(selection.ref);
    if (entry !== undefined && compatible(entry, body))
      (parts as Record<string, unknown>)[slot] = selection;
  }
  return {...CHARACTER, body: {ref: bodyRef}, parts} as CharacterSpec;
}

function idleSettings(): RenderSettings {
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
    {clipId: idle, label: 'idle', frameCount: IDLE_FRAMES, fps: 8, loop: true},
  ];
  return s as RenderSettings;
}

/** Row of the lowest opaque pixel, counted from the bottom edge (-1 when the frame is empty). */
function lowestOpaqueRow(f: RenderedFrame): number {
  for (let y = CELL - 1; y >= 0; y--) {
    for (let x = 0; x < CELL; x++) {
      if (f.pixels[(y * CELL + x) * 4 + 3] !== 0) return CELL - 1 - y;
    }
  }
  return -1;
}

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

  async function rowsFor(spec: CharacterSpec): Promise<number[]> {
    const set = await character.assembly.setCharacter(spec);
    if (!set.ok) throw new Error(set.error.message);
    const {frames} = await runExport(h, character, binder, idleSettings());
    expect(frames).toHaveLength(2 * IDLE_FRAMES);
    return frames.map(lowestOpaqueRow);
  }

  it(
    'AC-PIX-008.1: side view, pivotRowPx 2: the lowest opaque feet row (outline off) is row 2 from the bottom in every idle frame',
    {timeout: 240_000},
    async () => {
      const rows = await rowsFor(CHARACTER);
      expect(rows).toEqual(rows.map(() => PIVOT_ROW_PX));
    },
  );

  it(
    'AC-ANA-008.8: superhero-m and superhero-f (incompatible parts removed), idle, side, 64 px, pivotRowPx 2: the lowest opaque row is 2 in all 16 frames per body',
    {timeout: 300_000},
    async () => {
      const male = await rowsFor(await onBody(CHARACTER.body.ref));
      const femaleSpec = await onBody(FEMALE_BODY);
      // Every default part is restricted to superhero-m, so the female body shows its own feet.
      expect(femaleSpec.parts.feet).toBeUndefined();
      const female = await rowsFor(femaleSpec);
      console.log(
        `[m3-17] ${h.backend} lowest opaque rows: male ${male.join(',')} female ${female.join(',')}`,
      );
      expect({male, female}).toEqual({
        male: male.map(() => PIVOT_ROW_PX),
        female: female.map(() => PIVOT_ROW_PX),
      });
      const reset = await character.assembly.setCharacter(CHARACTER);
      if (!reset.ok) throw new Error(reset.error.message);
    },
  );
});
