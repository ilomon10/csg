/**
 * Shared loader of the shipped look presets (spec 006 REQ-EDT-044) for the golden and perf
 * suites. Not a test file: reads `assets/packs/quaternius-ubc/presets/looks/<id>.json` and turns a
 * preset into `RenderSettings` input fields.
 */
import {lookPresetSchema} from '@csg/parts-schema';
import type {LookPreset} from '@csg/parts-schema';

/** The four presets of REQ-EDT-044, by file id. */
export const LOOK_PRESET_IDS = [
  'classic-16bit',
  'gameboy-4',
  'nes-like',
  'hi-bit',
] as const;

/** One of {@link LOOK_PRESET_IDS}. */
export type LookPresetId = (typeof LOOK_PRESET_IDS)[number];

const LOOK_URLS = import.meta.glob(
  '../../../../assets/packs/quaternius-ubc/presets/looks/*.json',
  {query: '?url', import: 'default', eager: true},
);

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/** Fetches and validates the shipped look preset `id`. */
export async function loadLookPreset(id: LookPresetId): Promise<LookPreset> {
  const entry = Object.entries(LOOK_URLS).find(([path]) =>
    path.endsWith(`/looks/${id}.json`),
  );
  if (entry === undefined) throw new Error(`look preset ${id} not served`);
  const res = await fetch(entry[1]);
  if (!res.ok) throw new Error(`${entry[1]}: HTTP ${res.status}`);
  const preset = lookPresetSchema.parse(await res.json());
  if (preset.id !== id) throw new Error(`${entry[0]}: id is ${preset.id}`);
  return preset;
}

/**
 * The top-level `RenderSettings` input fields a preset sets: its graph refs, params and typed
 * `render` patch. Passed to `parseRenderSettings` next to resolution, camera, directions and
 * clips, missing nested fields take the schema defaults, which equals applying the patch to the
 * default settings (`resolveRenderPatch` of the Look panel). The side pivot row is left unset so
 * it follows the preset's outline width.
 */
export function lookFields(preset: LookPreset): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    materialGraph: preset.materialGraph,
    postGraph: preset.postGraph,
    params: preset.params,
  };
  for (const [key, value] of Object.entries(preset.render ?? {})) {
    if (!FORBIDDEN.has(key)) fields[key] = value;
  }
  return fields;
}
