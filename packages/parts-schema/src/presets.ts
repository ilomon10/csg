import {z} from 'zod';
import {ANATOMY_PARAM_SPECS, anatomyParamsSchema} from './anatomy';
import type {AnatomyParams} from './anatomy';
import {ANATOMY_PARAM_KEYS, tintSlotSchema} from './body';
import {
  DEFAULT_CLIP_REFS,
  characterSpecSchema,
  migrateCharacterSpec,
} from './character-spec';
import type {PartEntry} from './part-manifest';
import {
  characterStyleSchema,
  clipRefSchema,
  hexColorSchema,
  slotIdSchema,
  toSchemaIssues,
} from './primitives';
import type {
  CharacterSpecies,
  CharacterStyle,
  SchemaIssue,
  SchemaResult,
} from './primitives';
import {CAMERA_PRESETS, PALETTE_IDS} from './render-settings';

/** Preset and category IDs: `[a-z0-9-]{1,32}`. */
const presetIdSchema = z.string().regex(/^[a-z0-9-]{1,32}$/, {
  error: issue =>
    `invalid id ${JSON.stringify(issue.input)}: must match [a-z0-9-]{1,32}`,
});

/** i18n message key or icon id: lowercase dotted or dashed words. */
const keySchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/, {
  error: 'must be a lowercase key such as ux.easy.hair',
});

/** Relative, forward-slash path inside a pack (no `.` or `..` segment, scheme, `%`, `?`, `#` or leading slash). */
const relativePathSchema = z
  .string()
  .max(256)
  .refine(
    value =>
      value.length > 0 &&
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !value.includes(':') &&
      !/[%?#]/.test(value) &&
      !value
        .split('/')
        .some(segment => segment === '..' || segment === '.' || segment === ''),
    {error: 'must be a relative path inside the pack'},
  );

const unique = (values: readonly string[]) =>
  new Set(values).size === values.length;

// ---- anatomy presets (REQ-ANA-013) ----

/** Data file `presets/anatomy/<id>.json` (spec 002 `AnatomyPreset`). */
export const anatomyPresetSchema = z.object({
  format: z.literal('sprite-anatomy-preset'),
  version: z.literal(1),
  id: presetIdSchema,
  label: z.string().min(1).max(64),
  /** Suggested output resolutions for the readability hint. */
  recommendedPx: z.tuple([z.number().int(), z.number().int()]).optional(),
  values: anatomyParamsSchema,
});

/** Inferred type of {@link anatomyPresetSchema}. */
export type AnatomyPreset = z.infer<typeof anatomyPresetSchema>;

// ---- body-shape presets (REQ-ANA-022) ----

const factorSchema = z
  .number()
  .finite()
  .transform(value => Math.round(value * 100) / 100)
  .refine(value => value >= 0.5 && value <= 1.5, {
    error: 'factor must be between 0.5 and 1.5',
  });

/** Relative factors over the nine anatomy values; each 0.50..1.50 in 0.01 steps, unknown keys rejected. */
export const bodyShapeFactorsSchema = z.strictObject({
  height: factorSchema.optional(),
  head: factorSchema.optional(),
  torsoWidth: factorSchema.optional(),
  shoulders: factorSchema.optional(),
  armLength: factorSchema.optional(),
  legLength: factorSchema.optional(),
  hands: factorSchema.optional(),
  feet: factorSchema.optional(),
  limbThickness: factorSchema.optional(),
});

/** Data file `presets/body-shapes/<id>.json` (spec 002 `BodyShapePreset`). Strict object. */
export const bodyShapePresetSchema = z.strictObject({
  format: z.literal('sprite-body-shape-preset'),
  version: z.literal(1),
  id: presetIdSchema,
  /** i18n message key. */
  label: keySchema,
  /** Menu position; shipped presets use 10, 20, ... 60. */
  order: z.number().int().min(0).max(100000),
  factors: bodyShapeFactorsSchema,
});

/** Inferred type of {@link bodyShapePresetSchema}. */
export type BodyShapePreset = z.infer<typeof bodyShapePresetSchema>;

/**
 * Applies a body-shape preset (REQ-ANA-023): each value is
 * `clamp(q(base[p] * factor[p]), min[p], max[p])` where `q` rounds to 0.01 in integer hundredths,
 * `q = floor((B * F + 50) / 100) / 100` with `B = round(100 * base[p])` and
 * `F = round(100 * factor[p])`. An absent factor is 1.00. Integer arithmetic only, so Node and
 * browsers agree (AC-ANA-023.4).
 *
 * @param base The style's anatomy preset values (the `default` preset when the style names none).
 * @param factors The body shape's factors.
 */
export function applyBodyShape(
  base: AnatomyParams,
  factors: Partial<AnatomyParams>,
): AnatomyParams {
  const out = {...base};
  for (const key of ANATOMY_PARAM_KEYS) {
    const b = Math.round(100 * base[key]);
    const f = Math.round(100 * (factors[key] ?? 1));
    const hundredths = Math.floor((b * f + 50) / 100);
    const {min, max} = ANATOMY_PARAM_SPECS[key];
    out[key] = Math.min(max, Math.max(min, hundredths / 100));
  }
  return out;
}

// ---- style definitions (REQ-ANA-024) ----

/** Data file `presets/styles/<style>.json` (spec 002 `StyleDefinition`). */
export const styleDefinitionSchema = z.object({
  format: z.literal('sprite-style'),
  version: z.literal(1),
  style: characterStyleSchema,
  /** Anatomy preset ID applied when the user picks this style (REQ-CMP-042). */
  anatomyPreset: presetIdSchema.optional(),
  /** Clips hidden while this style is active (REQ-ANA-025). */
  excludedClips: z.array(
    z.object({clip: clipRefSchema, reason: z.string().min(1)}),
  ),
});

/** Inferred type of {@link styleDefinitionSchema}. */
export type StyleDefinition = z.infer<typeof styleDefinitionSchema>;

/**
 * Cross-file checks of the style data files (REQ-ANA-024): `anatomyPreset` must be a shipped
 * anatomy preset ID, no file may exclude a default clip (`idle`, `walk`), and no two files may
 * share a `style`. Issues carry the style as `entryId` and the field path
 * (`anatomyPreset`, `excludedClips.<index>`, `style`). Clip refs not registered anywhere are not
 * checked here: they are ignored at runtime (AC-ANA-024.3).
 */
export function validateStyleDefinitions(
  styles: readonly StyleDefinition[],
  anatomyPresetIds: ReadonlySet<string>,
): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  const seen = new Set<string>();
  const defaults = new Set<string>(DEFAULT_CLIP_REFS);
  for (const style of styles) {
    const at = (path: string, message: string): void => {
      issues.push({
        path,
        message,
        entryId: style.style,
        field: path.split('.')[0] ?? path,
      });
    };
    if (
      style.anatomyPreset !== undefined &&
      !anatomyPresetIds.has(style.anatomyPreset)
    ) {
      at('anatomyPreset', `unknown anatomy preset "${style.anatomyPreset}"`);
    }
    style.excludedClips.forEach((entry, index) => {
      if (defaults.has(entry.clip)) {
        at(
          `excludedClips.${index}`,
          `default clip ${entry.clip} cannot be excluded`,
        );
      }
    });
    if (seen.has(style.style))
      at('style', `duplicate style file for "${style.style}"`);
    seen.add(style.style);
  }
  return issues;
}

// ---- Easy categories and swatches (spec 014) ----

/** Easy workspace category IDs (spec 009 `EasyCategoryId`), in tab order. */
export const EASY_CATEGORY_IDS = [
  'body',
  'skin',
  'face',
  'hair',
  'outfit',
  'accessories',
  'colors',
] as const;

/** An Easy category ID. */
export type EasyCategoryId = (typeof EASY_CATEGORY_IDS)[number];

/** Data file mapping an Easy category to document fields (REQ-UX-060). */
export const easyCategoryDefSchema = z
  .object({
    format: z.literal('sprite-easy-category'),
    version: z.literal(1),
    id: z.enum(EASY_CATEGORY_IDS),
    /** i18n key, for example `ux.easy.hair`. */
    labelKey: keySchema,
    /** Icon id from the bundled icon set. */
    icon: keySchema,
    /** Slot IDs from the slot registry, in group order. */
    slots: z.array(slotIdSchema),
    tintChannels: z.array(tintSlotSchema),
    /** True only for `body` (the Shape group). */
    anatomyPresets: z.boolean(),
  })
  .superRefine((def, ctx) => {
    if (!unique(def.slots)) {
      ctx.addIssue({
        code: 'custom',
        path: ['slots'],
        message: 'slots has duplicates',
      });
    }
    if (!unique(def.tintChannels)) {
      ctx.addIssue({
        code: 'custom',
        path: ['tintChannels'],
        message: 'tintChannels has duplicates',
      });
    }
  });

/** Inferred type of {@link easyCategoryDefSchema}. */
export type EasyCategoryDef = z.infer<typeof easyCategoryDefSchema>;

/** Data file of swatches for one or more tint channels (REQ-UX-062): 4 to 24 entries. */
export const swatchSetDefSchema = z.object({
  format: z.literal('sprite-swatch-set'),
  version: z.literal(1),
  id: presetIdSchema,
  channels: z.array(tintSlotSchema).min(1),
  swatches: z
    .array(z.object({hex: hexColorSchema, nameKey: keySchema}))
    .min(4)
    .max(24),
});

/** Inferred type of {@link swatchSetDefSchema}. */
export type SwatchSetDef = z.infer<typeof swatchSetDefSchema>;

// ---- character presets (REQ-CMP-027, REQ-UX-072/103) ----

/** Camera presets a character preset may select (Q4): `custom` needs an elevation and is excluded. */
export const PRESET_CAMERAS = CAMERA_PRESETS.filter(
  (preset): preset is Exclude<(typeof CAMERA_PRESETS)[number], 'custom'> =>
    preset !== 'custom',
);

/** Data file `presets/characters/<id>.json`: a ready-made `CharacterSpec` for the home lineup. */
export const characterPresetSchema = z.strictObject({
  format: z.literal('sprite-character-preset'),
  version: z.literal(1),
  id: presetIdSchema,
  name: z.string().min(1).max(64),
  character: characterSpecSchema,
  /** Sets `render.camera.preset` of the project made from this preset (REQ-UX-072, Q4). */
  camera: z.enum(PRESET_CAMERAS).optional(),
});

/** Inferred type of {@link characterPresetSchema}. */
export type CharacterPreset = z.infer<typeof characterPresetSchema>;

/**
 * Parses a character preset file. The embedded `character` is migrated by its own version first
 * (REQ-CMP-049, AC-CMP-049.2), so a version-1 preset loads as version 2. Never throws; issues
 * carry the preset ID as `entryId` when known.
 */
export function parseCharacterPreset(
  json: unknown,
): SchemaResult<CharacterPreset> {
  let input = json;
  if (typeof json === 'object' && json !== null && !Array.isArray(json)) {
    const record = json as Record<string, unknown>;
    const migrated = migrateCharacterSpec(record['character']);
    if (!migrated.ok) {
      return {
        ok: false,
        issues: migrated.issues.map(issue => ({
          ...issue,
          path: issue.path === '' ? 'character' : `character.${issue.path}`,
        })),
      };
    }
    input = {...record, character: migrated.value};
  }
  return parsePresetFile(characterPresetSchema, input);
}

// ---- look presets (REQ-EDT-044, D8, Q5) ----

/** RenderSettings keys a look preset must not touch: framing, directions and clips are not looks. */
const NON_LOOK_KEYS: ReadonlySet<string> = new Set([
  'resolution',
  'camera',
  'directions',
  'singleFacing',
  'mirrorWest',
  'animations',
]);

/**
 * Data file `presets/looks/<id>.json` (spec 006 `LookPreset`, M3 form): graph references are
 * `builtin:` strings, and the look is a `RenderSettings` patch (`render`) over typed fields.
 * The patch is validated when applied with `parseRenderSettings`.
 */
export const lookPresetSchema = z.object({
  format: z.literal('sprite-look-preset'),
  version: z.literal(1),
  id: presetIdSchema,
  name: z.string().min(1).max(64),
  description: z.string().max(256),
  /** Relative path to a 64x64 PNG or WebP inside the pack. */
  thumbnail: relativePathSchema,
  materialGraph: z.string().regex(/^builtin:.{1,64}$/),
  postGraph: z.string().regex(/^builtin:.{1,64}$/),
  params: z.record(
    z.string().min(1),
    z.union([
      z.number().finite(),
      z.boolean(),
      hexColorSchema,
      z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
    ]),
  ),
  palette: z
    .object({
      id: z.enum(PALETTE_IDS),
      colors: z.array(hexColorSchema).min(1).max(256).optional(),
    })
    .optional(),
  /** Partial `RenderSettings` over the typed fields (Q5); no camera, resolution or clips. */
  render: z
    .record(z.string(), z.unknown())
    .refine(patch => Object.keys(patch).every(key => !NON_LOOK_KEYS.has(key)), {
      error:
        'a look may not set resolution, camera, directions, singleFacing, mirrorWest or animations',
    })
    .optional(),
});

/** Inferred type of {@link lookPresetSchema}. */
export type LookPreset = z.infer<typeof lookPresetSchema>;

// ---- preset index ----

/** Kinds of preset files a pack's `presets/index.json` lists. */
export const PRESET_FILE_KINDS = [
  'anatomy-preset',
  'body-shape',
  'style',
  'easy-category',
  'swatch-set',
  'character',
  'look',
] as const;

/** A preset file kind. */
export type PresetFileKind = (typeof PRESET_FILE_KINDS)[number];

/**
 * `presets/index.json`, generated by `assets:build` because browsers cannot list folders. Paths
 * are relative to the pack base URL and unique.
 */
export const presetIndexSchema = z
  .object({
    format: z.literal('sprite-preset-index'),
    version: z.literal(1),
    files: z.array(
      z.object({kind: z.enum(PRESET_FILE_KINDS), path: relativePathSchema}),
    ),
  })
  .superRefine((index, ctx) => {
    index.files.forEach((file, i) => {
      if (index.files.findIndex(other => other.path === file.path) !== i) {
        ctx.addIssue({
          code: 'custom',
          path: ['files', i, 'path'],
          message: `duplicate path "${file.path}"`,
        });
      }
    });
  });

/** Inferred type of {@link presetIndexSchema}. */
export type PresetIndex = z.infer<typeof presetIndexSchema>;

/**
 * Validates one preset file against its schema; never throws. When the input has a string `id`
 * (or `style` for style files) it becomes the `entryId` of every issue, so a message names the
 * file and the field (AC-ANA-022.2, AC-ANA-024.2).
 */
export function parsePresetFile<T>(
  schema: z.ZodType<T>,
  json: unknown,
): SchemaResult<T> {
  const parsed = schema.safeParse(json);
  if (parsed.success) return {ok: true, value: parsed.data};
  const record =
    typeof json === 'object' && json !== null
      ? (json as Record<string, unknown>)
      : {};
  const id = typeof record['id'] === 'string' ? record['id'] : record['style'];
  const entryId = typeof id === 'string' ? id : undefined;
  return {
    ok: false,
    issues: toSchemaIssues(parsed.error).map(issue =>
      entryId === undefined ? issue : {...issue, entryId},
    ),
  };
}

// ---- style availability (REQ-CMP-045) ----

/**
 * The (style, species) pairs the user can pick (REQ-CMP-045): a pair of `supported` whose style
 * data file is loaded, and, for a species other than `human`, at least one loaded `species-head`
 * part that lists the species and fits the style (REQ-CMP-048 rule d). Pure; order follows
 * `supported`.
 */
export function availableStyleCombos(
  supported: ReadonlyArray<readonly [CharacterStyle, CharacterSpecies]>,
  loaded: {
    readonly styles: ReadonlySet<CharacterStyle>;
    readonly parts: readonly PartEntry[];
  },
): ReadonlyArray<readonly [CharacterStyle, CharacterSpecies]> {
  return supported.filter(([style, species]) => {
    if (!loaded.styles.has(style)) return false;
    if (species === 'human') return true;
    return loaded.parts.some(
      part =>
        part.slot === 'species-head' &&
        (part.species ?? []).includes(species) &&
        ((part.styles ?? []).length === 0 ||
          (part.styles ?? []).includes(style)),
    );
  });
}
