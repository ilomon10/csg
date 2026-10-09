import {
  ANATOMY_PARAM_KEYS,
  ANATOMY_PARAM_SPECS,
  applyBodyShape,
  defaultAnatomy,
  quantizeAnatomy,
} from '@csg/parts-schema';
import type {
  AnatomyParams,
  AnatomyPreset,
  BodyShapePreset,
  CharacterStyle,
} from '@csg/parts-schema';
import type {CharacterCommand} from '../../shared/document';

/** A body shape that may carry the folder of its per-style thumbnails (`<base>/<style>/<id>.webp`). */
export type ThumbnailedBodyShape = BodyShapePreset & {
  readonly thumbnailBase?: string;
};

/** The slice of the shared catalog the anatomy widgets read. `Catalog` satisfies it. */
export interface AnatomyCatalog {
  readonly anatomyPresets: ReadonlyMap<string, AnatomyPreset>;
  readonly bodyShapes: readonly ThumbnailedBodyShape[];
  readonly styles: ReadonlyMap<
    CharacterStyle,
    {readonly anatomyPreset?: string | undefined}
  >;
}

/** One anatomy parameter key. */
export type AnatomyKey = (typeof ANATOMY_PARAM_KEYS)[number];

/** Clamps to the REQ-ANA-001 range and quantizes to 0.01. */
export function clampAnatomyValue(key: AnatomyKey, value: number): number {
  const {min, max} = ANATOMY_PARAM_SPECS[key];
  return Math.min(max, Math.max(min, quantizeAnatomy(value)));
}

/** Adds `delta` in integer hundredths, then clamps (no float drift on repeated steps). */
export function stepAnatomyValue(
  key: AnatomyKey,
  value: number,
  delta: number,
): number {
  return clampAnatomyValue(
    key,
    (Math.round(value * 100) + Math.round(delta * 100)) / 100,
  );
}

/** True when all nine values are equal. */
export function sameAnatomy(a: AnatomyParams, b: AnatomyParams): boolean {
  return ANATOMY_PARAM_KEYS.every(key => a[key] === b[key]);
}

/** The style's base proportions: its anatomy preset, or the defaults (REQ-ANA-023). */
export function styleBase(
  catalog: AnatomyCatalog,
  style: CharacterStyle,
): AnatomyParams {
  const id = catalog.styles.get(style)?.anatomyPreset;
  const preset = id === undefined ? undefined : catalog.anatomyPresets.get(id);
  return preset ? {...preset.values} : defaultAnatomy();
}

/** Body shapes in menu order (`order`, then id). */
export function orderedBodyShapes(
  catalog: AnatomyCatalog,
): readonly ThumbnailedBodyShape[] {
  return [...catalog.bodyShapes].sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  );
}

/**
 * The body shape whose application to the style base equals `anatomy`, or null (REQ-UX-055:
 * the Shape group then shows "Custom").
 */
export function matchingBodyShape(
  anatomy: AnatomyParams,
  style: CharacterStyle,
  catalog: AnatomyCatalog,
): string | null {
  const base = styleBase(catalog, style);
  for (const shape of orderedBodyShapes(catalog)) {
    if (sameAnatomy(applyBodyShape(base, shape.factors), anatomy)) {
      return shape.id;
    }
  }
  return null;
}

/** Which preset the panel shows as selected and whether the values drifted from it (REQ-ANA-014). */
export interface PresetState {
  readonly id: string;
  readonly modified: boolean;
}

/**
 * Exact match first, then the preset the user applied last, then the nearest preset (fewest
 * differing values, the style's own preset winning ties), which reads "(modified)".
 */
export function resolvePreset(
  anatomy: AnatomyParams,
  style: CharacterStyle,
  catalog: AnatomyCatalog,
  remembered: string | null,
): PresetState | null {
  const presets = [...catalog.anatomyPresets.values()];
  if (presets.length === 0) return null;
  const exact = presets.find(p => sameAnatomy(p.values, anatomy));
  if (exact) return {id: exact.id, modified: false};
  const kept = remembered ? catalog.anatomyPresets.get(remembered) : undefined;
  if (kept) return {id: kept.id, modified: true};
  const own = catalog.styles.get(style)?.anatomyPreset;
  let best: AnatomyPreset | undefined;
  let bestDiff = Infinity;
  const ordered = [...presets].sort(
    (a, b) => Number(b.id === own) - Number(a.id === own),
  );
  for (const preset of ordered) {
    const diff = ANATOMY_PARAM_KEYS.filter(
      key => preset.values[key] !== anatomy[key],
    ).length;
    if (diff < bestDiff) {
      best = preset;
      bestDiff = diff;
    }
  }
  return best ? {id: best.id, modified: true} : null;
}

/**
 * Sets one anatomy value as a command (REQ-ANA-017). The coalesce key folds a keyboard burst
 * into one undo step; a pointer drag is wrapped in a gesture by the caller.
 */
export function setAnatomyValue(
  key: AnatomyKey,
  value: number,
  label: string,
): CharacterCommand {
  return {
    label: `Change ${label}`,
    feature: 'anatomy',
    coalesceKey: `anatomy:${key}`,
    run(spec) {
      const next = clampAnatomyValue(key, value);
      if (spec.anatomy[key] === next) return null;
      return {
        spec: {...spec, anatomy: {...spec.anatomy, [key]: next}},
        removed: [],
      };
    },
  };
}
