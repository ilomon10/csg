import './zod-config';
import {z} from 'zod';
import {anatomyParamsSchema, quantizeAnatomy} from './anatomy';
import {ANATOMY_PARAM_KEYS, TINT_SLOTS, tintSlotSchema} from './body';
import defaultCharacterJson from '../data/default-character.json';
import {partSocketSchema} from './part-manifest';
import {
  CHARACTER_FORMAT_VERSION,
  assetRefSchema,
  characterSpeciesSchema,
  characterStyleSchema,
  clipRefSchema,
  hexColorSchema,
  slotIdSchema,
  toSchemaIssues,
} from './primitives';
import type {AssetRef, ClipRef, SchemaIssue} from './primitives';
import {V1_SLOT_IDS} from './slots';

/** One composition axis: -1.00..1.00, quantized to 0.01 before the range check (AC-CMP-041.2). */
const compositionAxisSchema = z
  .number()
  .finite()
  .transform(quantizeAnatomy)
  .refine(value => value >= -1 && value <= 1, {
    error: 'must be between -1 and 1',
  });

/**
 * Body composition (REQ-CMP-041): `weight` and `muscle`, each -1.00..1.00 in 0.01 steps. Both
 * keys are required when the object is present. Kept on round trip; rendering arrives with
 * spec 013 (M3.5).
 */
export const bodyCompositionSchema = z.object({
  weight: compositionAxisSchema,
  muscle: compositionAxisSchema,
});

/** Inferred type of {@link bodyCompositionSchema}. */
export type BodyComposition = z.infer<typeof bodyCompositionSchema>;

/** One equipped part (architecture §3.3). */
export const partSelectionSchema = z.object({
  ref: assetRefSchema,
  /** Per-part tint overrides; fall back to `CharacterSpec.tints`. */
  tints: z.partialRecord(tintSlotSchema, hexColorSchema).optional(),
  /** Only for static parts; overrides the manifest socket and offset. */
  socket: partSocketSchema.optional(),
});

/** Inferred type of {@link partSelectionSchema}. */
export type PartSelection = z.infer<typeof partSelectionSchema>;

/**
 * Persisted `sprite-character` document, version 2 (spec 001 Data & contracts). Keys are in
 * canonical order (AC-CMP-038.3); `style` and `species` are required and never coerced
 * (REQ-CMP-038, REQ-CMP-040).
 */
export const characterSpecSchema = z.object({
  format: z.literal('sprite-character'),
  version: z.literal(CHARACTER_FORMAT_VERSION),
  name: z.string().min(1).max(64),
  /** uint32 seed used by randomize; stored so a result is reproducible. */
  seed: z.number().int().min(0).max(4294967295),
  /** Body style (REQ-CMP-038). */
  style: characterStyleSchema,
  /** Species (REQ-CMP-038). */
  species: characterSpeciesSchema,
  /** The body defines the skeleton; always present (`CMP_BODY_MISSING`). */
  body: partSelectionSchema,
  /** Keys are non-body slot IDs; an absent key is an empty slot. */
  parts: z
    .record(slotIdSchema, partSelectionSchema)
    .refine(parts => !('body' in parts), {
      error: 'the body belongs in `body`, not in `parts`',
    }),
  anatomy: anatomyParamsSchema,
  /** Morph weights by name. Names the body lacks are kept on round trip (AC-ANA-012.3). */
  morphs: z.record(z.string().min(1), z.number().finite().min(0).max(1)),
  /** All 7 tint slots are required. */
  tints: z.record(tintSlotSchema, hexColorSchema),
  /** Absent means `{weight: 0, muscle: 0}`; omitted from canonical JSON when both are 0. */
  composition: bodyCompositionSchema.optional(),
  face: z
    .object({
      decal: assetRefSchema.nullable(),
      offsetPx: z.tuple([
        z.number().int().min(-4).max(4),
        z.number().int().min(-4).max(4),
      ]),
    })
    .optional(),
});

/** Inferred type of {@link characterSpecSchema}. */
export type CharacterSpec = z.infer<typeof characterSpecSchema>;

/** A pure `vN -> vN+1` migration over the raw document (rules: run before validation). */
export type CharacterMigration = (
  doc: Record<string, unknown>,
) => Record<string, unknown>;

/**
 * Migrations keyed by the version they upgrade from: entry `N` turns a v`N` document into
 * v`N+1`. Entry 1 (REQ-CMP-039) sets `style: 'realistic'` and `species: 'human'` and changes
 * no other field; it always overrides, even a hand-edited v1 that already holds those keys
 * (AC-CMP-039.3). Pure: never mutates its input. A version bump adds an entry here and a
 * fixture test built from the previous version.
 */
export const CHARACTER_MIGRATIONS: Readonly<
  Record<number, CharacterMigration>
> = {
  1: doc => ({...doc, style: 'realistic', species: 'human'}),
};

/** Why a character spec failed to load (spec 001). */
export type CharacterSpecErrorCode = 'CMP_BODY_MISSING' | 'CMP_SPEC_INVALID';

/** Result of {@link parseCharacterSpec}; never throws. */
export type CharacterSpecResult =
  | {ok: true; value: CharacterSpec}
  | {ok: false; code: CharacterSpecErrorCode; issues: SchemaIssue[]};

/**
 * Runs the migration chain from the document's `version` up to `latest` (REQ-CMP-023).
 * Rejects an unknown `format`, a non-integer or newer `version`, and a missing step.
 * Does not mutate its input.
 */
export function migrateCharacterSpec(
  json: unknown,
  migrations: Readonly<
    Record<number, CharacterMigration>
  > = CHARACTER_MIGRATIONS,
  latest: number = CHARACTER_FORMAT_VERSION,
): {ok: true; value: unknown} | {ok: false; issues: SchemaIssue[]} {
  const fail = (message: string, path: string) => ({
    ok: false as const,
    issues: [{path, message}],
  });
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return fail('character spec must be an object', '');
  }
  let doc = {...(json as Record<string, unknown>)};
  if (doc['format'] !== 'sprite-character') {
    return fail('format must be "sprite-character"', 'format');
  }
  let version = doc['version'];
  if (
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    return fail('version must be a positive integer', 'version');
  }
  if (version > latest) {
    return fail(
      `version ${version} is newer than the supported version ${latest}`,
      'version',
    );
  }
  while (version < latest) {
    const step = migrations[version];
    if (step === undefined) {
      return fail(`no migration from version ${version}`, 'version');
    }
    doc = {...step(doc), version: version + 1};
    version += 1;
  }
  return {ok: true, value: doc};
}

/**
 * Migrates, then validates a parsed character document. A document without `body` fails with
 * `CMP_BODY_MISSING` (AC-CMP-002.2); every other failure is `CMP_SPEC_INVALID` with the
 * failing paths. Never throws.
 */
export function parseCharacterSpec(json: unknown): CharacterSpecResult {
  if (
    typeof json === 'object' &&
    json !== null &&
    !Array.isArray(json) &&
    ((json as Record<string, unknown>)['body'] === undefined ||
      (json as Record<string, unknown>)['body'] === null)
  ) {
    return {
      ok: false,
      code: 'CMP_BODY_MISSING',
      issues: [
        {
          path: 'body',
          message: 'CMP_BODY_MISSING: body is required',
          field: 'body',
        },
      ],
    };
  }
  const migrated = migrateCharacterSpec(json);
  if (!migrated.ok) {
    return {ok: false, code: 'CMP_SPEC_INVALID', issues: migrated.issues};
  }
  const parsed = characterSpecSchema.safeParse(migrated.value);
  if (parsed.success) return {ok: true, value: parsed.data};
  return {
    ok: false,
    code: 'CMP_SPEC_INVALID',
    issues: toSchemaIssues(parsed.error),
  };
}

/** Shipped default character data file (`data/default-character.json`, REQ-CMP-036). */
export const defaultCharacterDataSchema = z.object({
  format: z.literal('sprite-default-character'),
  version: z.literal(1),
  character: characterSpecSchema,
  /** Default clips, in menu order; the first is the one the preview starts with. */
  clips: z.array(clipRefSchema).min(1),
});

/** Inferred type of {@link defaultCharacterDataSchema}. */
export type DefaultCharacterData = z.infer<typeof defaultCharacterDataSchema>;

/** The validated default character data (parsed once at module load; throws if invalid). */
export const DEFAULT_CHARACTER_DATA: DefaultCharacterData =
  defaultCharacterDataSchema.parse(defaultCharacterJson);

/** Body of the shipped default character (REQ-CMP-036). */
export const DEFAULT_BODY_REF: AssetRef =
  DEFAULT_CHARACTER_DATA.character.body.ref;

/** Default clip refs (idle first, then walk), from the same data file. */
export const DEFAULT_CLIP_REFS: readonly ClipRef[] =
  DEFAULT_CHARACTER_DATA.clips;

/**
 * Default `CharacterSpec` (REQ-CMP-036, spec 001 Data & contracts), read from
 * `data/default-character.json`: body `superhero-m`, hair, eyebrows and the male ranger outfit,
 * every anatomy value 1, `seed: 0`. Returns a fresh copy each call (the schema parse clones).
 */
export function createDefaultCharacterSpec(): CharacterSpec {
  return characterSpecSchema.parse(DEFAULT_CHARACTER_DATA.character);
}

const orderedKeys = <T extends string>(
  record: Readonly<Partial<Record<T, unknown>>>,
  order: readonly T[],
): T[] => order.filter(key => record[key] !== undefined);

function canonicalSelection(selection: PartSelection): Record<string, unknown> {
  const out: Record<string, unknown> = {ref: selection.ref};
  if (selection.tints !== undefined) {
    const tints: Record<string, unknown> = {};
    for (const slot of orderedKeys(selection.tints, TINT_SLOTS)) {
      tints[slot] = selection.tints[slot];
    }
    out['tints'] = tints;
  }
  if (selection.socket !== undefined) out['socket'] = selection.socket;
  return out;
}

/**
 * The document as a plain object with keys in canonical order (AC-CMP-038.3): `format, version,
 * name, seed, style, species, body, parts, anatomy, morphs, tints`, then `composition` (omitted
 * when both values are 0, REQ-CMP-041) and `face`. `parts` follow slot-registry order; unknown
 * slot IDs follow, sorted by code unit. Morph names are sorted.
 */
export function canonicalCharacterObject(
  spec: CharacterSpec,
): Record<string, unknown> {
  const partOrder: string[] = [...V1_SLOT_IDS];
  const slotKeys = Object.keys(spec.parts);
  const known = partOrder.filter(slot => slotKeys.includes(slot));
  const unknown = slotKeys.filter(slot => !partOrder.includes(slot)).sort();
  const parts: Record<string, unknown> = {};
  for (const slot of [...known, ...unknown]) {
    const selection = spec.parts[slot];
    if (selection !== undefined) parts[slot] = canonicalSelection(selection);
  }
  const anatomy: Record<string, unknown> = {};
  for (const key of ANATOMY_PARAM_KEYS) anatomy[key] = spec.anatomy[key];
  const morphs: Record<string, unknown> = {};
  for (const name of Object.keys(spec.morphs).sort()) {
    morphs[name] = spec.morphs[name];
  }
  const tints: Record<string, unknown> = {};
  for (const slot of orderedKeys(spec.tints, TINT_SLOTS)) {
    tints[slot] = spec.tints[slot];
  }
  const out: Record<string, unknown> = {
    format: spec.format,
    version: spec.version,
    name: spec.name,
    seed: spec.seed,
    style: spec.style,
    species: spec.species,
    body: canonicalSelection(spec.body),
    parts,
    anatomy,
    morphs,
    tints,
  };
  const composition = spec.composition;
  if (
    composition !== undefined &&
    (composition.weight !== 0 || composition.muscle !== 0)
  ) {
    out['composition'] = {
      weight: composition.weight,
      muscle: composition.muscle,
    };
  }
  if (spec.face !== undefined) {
    out['face'] = {decal: spec.face.decal, offsetPx: [...spec.face.offsetPx]};
  }
  return out;
}

/**
 * Canonical JSON of a character (REQ-CMP-022, REQ-CMP-025, AC-CMP-038.3): keys in schema order,
 * `parts` in slot-registry order, `composition` omitted at `{0, 0}`, no `undefined`. Equal
 * specs give byte-identical text.
 *
 * @param spec A validated spec.
 * @param indent Spaces per level; 2 for saved files (REQ-CMP-022, the default), 0 for the
 *     compact form used in share fragments and hashes.
 */
export function canonicalCharacterJson(
  spec: CharacterSpec,
  indent: number = 2,
): string {
  return JSON.stringify(canonicalCharacterObject(spec), null, indent);
}
