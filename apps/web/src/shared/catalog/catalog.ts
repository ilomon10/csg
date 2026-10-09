import {
  anatomyPresetSchema,
  availableStyleCombos,
  bodyShapePresetSchema,
  characterPresetSchema,
  easyCategoryDefSchema,
  loadSlotRegistry,
  lookPresetSchema,
  parsePresetFile,
  presetIndexSchema,
  styleDefinitionSchema,
  swatchSetDefSchema,
  findForbiddenKey,
  parseJson,
} from '@csg/parts-schema';
import type {
  AnatomyPreset,
  BodyShapePreset,
  CharacterPreset,
  CharacterSpec,
  CharacterSpecies,
  CharacterStyle,
  ClipEntry,
  EasyCategoryDef,
  LookPreset,
  PartEntry,
  PresetFileKind,
  SlotRegistry,
  StyleDefinition,
  SwatchSetDef,
} from '@csg/parts-schema';
import {
  SUPPORTED_STYLE_COMBOS,
  checkCompatibility,
  parseClipManifestJson,
  parsePartManifestJson,
} from '@csg/engine/catalog';
import {devWarn, fail, ok} from '../persistence/types';
import type {Result} from '../persistence/types';

/** A part with its asset reference and pack (REQ-CMP-001). */
export interface CatalogPart extends PartEntry {
  /** `builtin:<packId>/<partId>`. */
  readonly ref: string;
  readonly packId: string;
  /** Local URL of the thumbnail, when the pack has one. */
  readonly thumbnailUrl?: string;
}

/** A body shape with the local folder of its per-style thumbnails (`<dir>/<style>/<id>.webp`). */
export interface CatalogBodyShape extends BodyShapePreset {
  readonly packId: string;
  /** Local URL of the pack's `thumbnails/shapes` folder. */
  readonly thumbnailBase: string;
}

/** A character preset with its pack and local 128 px thumbnail URL. */
export interface CatalogCharacterPreset extends CharacterPreset {
  readonly packId: string;
  readonly thumbnailUrl: string;
}

/** A look preset with its pack and local thumbnail URL (`look.thumbnail` resolved). */
export interface CatalogLookPreset extends LookPreset {
  readonly packId: string;
  readonly thumbnailUrl: string;
}

/** A clip with its asset reference and pack. */
export interface CatalogClip extends ClipEntry {
  readonly ref: string;
  readonly packId: string;
}

/** Everything the editor knows before the engine loads (D4, REQ-UX-083). */
export interface Catalog {
  readonly slots: SlotRegistry;
  readonly parts: readonly CatalogPart[];
  readonly clips: readonly CatalogClip[];
  readonly anatomyPresets: ReadonlyMap<string, AnatomyPreset>;
  readonly bodyShapes: readonly CatalogBodyShape[];
  readonly styles: ReadonlyMap<CharacterStyle, StyleDefinition>;
  readonly easyCategories: readonly EasyCategoryDef[];
  readonly swatchSets: readonly SwatchSetDef[];
  readonly characterPresets: readonly CatalogCharacterPreset[];
  readonly lookPresets: readonly CatalogLookPreset[];
  /** `packId@<first 16 hex of SHA-256 of manifest.json>` per pack (D10). */
  readonly packVersions: readonly string[];
  /** Style and species pairs the user can pick (REQ-CMP-045). */
  readonly availableCombos: ReadonlyArray<
    readonly [CharacterStyle, CharacterSpecies]
  >;
  /** Whether `part` can be equipped on `spec` (REQ-CMP-008, REQ-CMP-048). */
  compatible(
    part: CatalogPart,
    spec: CharacterSpec,
  ): {ok: true} | {ok: false; reason: string};
}

/** Where and how to load. */
export interface LoadCatalogOptions {
  /** Parsed `slots.json` (the slot registry data file). */
  readonly slotRegistry: unknown;
  /** URL prefix of the packs; default `/packs`. */
  readonly baseUrl?: string;
  /** Supported pairs; default is the engine's `SUPPORTED_STYLE_COMBOS`. */
  readonly supportedCombos?: ReadonlyArray<
    readonly [CharacterStyle, CharacterSpecies]
  >;
}

const MAX_FILE_CHARS = 8 * 1024 * 1024;

const error = (message: string) =>
  fail({code: 'UX_STORAGE_UNAVAILABLE' as const, message});

async function sha16(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest).slice(0, 8), b =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

/** Reads optional text; a missing file or a bad size is `null`. */
async function tryFetch(
  fetchText: (url: string) => Promise<string>,
  url: string,
): Promise<string | null> {
  try {
    const text = await fetchText(url);
    return text.length > MAX_FILE_CHARS ? null : text;
  } catch {
    return null;
  }
}

/**
 * Same-origin path of the built-in packs folder, without a trailing slash. Built from the page
 * base so a deploy under a sub-path (`/app/`) finds `packs/` next to the page, never at the
 * origin root. Falls back to `/packs` without a DOM.
 */
export function packsBaseUrl(): string {
  if (typeof document === 'undefined') return '/packs';
  return new URL('packs', document.baseURI).pathname;
}

/**
 * Loads pack manifests, clips and preset data files. Pack manifests are required and a bad one
 * fails the load. Clips and presets are optional, and an invalid preset file is skipped with a
 * dev-mode warning (spec 014 Data & contracts). Input is untrusted: forbidden keys and schema
 * failures are rejected (REQ-GEN-011, REQ-GEN-013).
 *
 * @param fetchText Same-origin text fetcher (never third-party).
 * @param packs Pack IDs in load order.
 */
export async function loadCatalog(
  fetchText: (url: string) => Promise<string>,
  packs: readonly string[],
  options: LoadCatalogOptions,
): Promise<Result<Catalog>> {
  const slots = loadSlotRegistry(options.slotRegistry);
  if (!slots.ok) {
    return error(`Slot registry invalid: ${slots.issues[0]?.message ?? ''}`);
  }
  const baseUrl = options.baseUrl ?? packsBaseUrl();
  const parts: CatalogPart[] = [];
  const clips: CatalogClip[] = [];
  const anatomyPresets = new Map<string, AnatomyPreset>();
  const bodyShapes: CatalogBodyShape[] = [];
  const styles = new Map<CharacterStyle, StyleDefinition>();
  const easyCategories: EasyCategoryDef[] = [];
  const swatchSets: SwatchSetDef[] = [];
  const characterPresets: CatalogCharacterPreset[] = [];
  const lookPresets: CatalogLookPreset[] = [];
  const packVersions: string[] = [];

  const addPreset = (
    kind: PresetFileKind,
    json: unknown,
    path: string,
    packId: string,
    base: string,
  ) => {
    const take = <T>(
      schema: Parameters<typeof parsePresetFile<T>>[0],
      into: (value: T) => void,
    ) => {
      const parsed = parsePresetFile(schema, json);
      if (parsed.ok) into(parsed.value);
      else
        devWarn(`preset ${path} skipped: ${parsed.issues[0]?.message ?? ''}`);
    };
    switch (kind) {
      case 'anatomy-preset':
        return take(anatomyPresetSchema, v => anatomyPresets.set(v.id, v));
      case 'body-shape':
        return take(bodyShapePresetSchema, v =>
          bodyShapes.push({
            ...v,
            packId,
            thumbnailBase: `${base}/thumbnails/shapes`,
          }),
        );
      case 'style':
        return take(styleDefinitionSchema, v => styles.set(v.style, v));
      case 'easy-category':
        return take(easyCategoryDefSchema, v => easyCategories.push(v));
      case 'swatch-set':
        return take(swatchSetDefSchema, v => swatchSets.push(v));
      case 'character':
        return take(characterPresetSchema, v =>
          characterPresets.push({
            ...v,
            packId,
            thumbnailUrl: `${base}/thumbnails/characters/${v.id}.webp`,
          }),
        );
      case 'look':
        return take(lookPresetSchema, v =>
          lookPresets.push({
            ...v,
            packId,
            thumbnailUrl: `${base}/${v.thumbnail}`,
          }),
        );
    }
  };

  for (const packId of packs) {
    const base = `${baseUrl}/${packId}`;
    const manifestText = await tryFetch(fetchText, `${base}/manifest.json`);
    if (manifestText === null)
      return error(`${base}/manifest.json could not be loaded`);
    const manifest = parsePartManifestJson(manifestText);
    if (!manifest.ok) {
      return error(
        `${base}/manifest.json: ${manifest.issues[0]?.message ?? 'invalid'}`,
      );
    }
    packVersions.push(`${manifest.value.packId}@${await sha16(manifestText)}`);
    for (const part of manifest.value.parts) {
      parts.push({
        ...part,
        ref: `builtin:${manifest.value.packId}/${part.id}`,
        packId: manifest.value.packId,
        ...(part.thumbnail === undefined
          ? {}
          : {thumbnailUrl: `${base}/${part.thumbnail}`}),
      });
    }

    const clipText = await tryFetch(fetchText, `${base}/clips.json`);
    if (clipText !== null) {
      const parsed = parseClipManifestJson(clipText);
      if (!parsed.ok) {
        return error(
          `${base}/clips.json: ${parsed.issues[0]?.message ?? 'invalid'}`,
        );
      }
      for (const clip of parsed.value.clips) {
        clips.push({
          ...clip,
          ref: `builtin:${parsed.value.packId}/${clip.id}`,
          packId: parsed.value.packId,
        });
      }
    }

    const indexText = await tryFetch(fetchText, `${base}/presets/index.json`);
    if (indexText === null) continue;
    const indexJson = parseJson(indexText);
    const index = indexJson.ok
      ? presetIndexSchema.safeParse(indexJson.value)
      : null;
    if (index === null || !index.success) {
      devWarn(`${base}/presets/index.json skipped: invalid`);
      continue;
    }
    for (const file of index.data.files) {
      const text = await tryFetch(fetchText, `${base}/${file.path}`);
      const json = text === null ? null : parseJson(text);
      if (json === null || !json.ok || findForbiddenKey(json.value) !== null) {
        devWarn(`preset ${base}/${file.path} skipped: unreadable`);
        continue;
      }
      addPreset(
        file.kind,
        json.value,
        `${base}/${file.path}`,
        manifest.value.packId,
        base,
      );
    }
  }

  const supported = options.supportedCombos ?? SUPPORTED_STYLE_COMBOS;
  const availableCombos = availableStyleCombos(supported, {
    styles: new Set(styles.keys()),
    parts,
  });
  const byRef = new Map(parts.map(p => [p.ref, p]));

  return ok({
    slots: slots.value,
    parts,
    clips,
    anatomyPresets,
    bodyShapes,
    styles,
    easyCategories,
    swatchSets,
    characterPresets,
    lookPresets,
    packVersions,
    availableCombos,
    compatible(part, spec) {
      const body = byRef.get(spec.body.ref);
      if (body === undefined) return {ok: false, reason: 'body'};
      const base = checkCompatibility(part, body);
      if (!base.ok) return base;
      const styleList = part.styles ?? [];
      if (styleList.length > 0 && !styleList.includes(spec.style)) {
        return {ok: false, reason: 'style'};
      }
      const speciesList = part.species ?? [];
      if (speciesList.length > 0 && !speciesList.includes(spec.species)) {
        return {ok: false, reason: 'species'};
      }
      return {ok: true};
    },
  });
}
