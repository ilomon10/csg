import {z} from 'zod';
import {anatomyParamsSchema, defaultAnatomy} from './anatomy';
import {tintSlotSchema} from './body';
import {partSocketSchema} from './part-manifest';
import {
  CHARACTER_FORMAT_VERSION,
  assetRefSchema,
  hexColorSchema,
  slotIdSchema,
  toSchemaIssues,
} from './primitives';
import type {AssetRef, SchemaIssue} from './primitives';

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

/** Persisted `sprite-character` document (spec 001 Data & contracts). */
export const characterSpecSchema = z.object({
  format: z.literal('sprite-character'),
  version: z.literal(CHARACTER_FORMAT_VERSION),
  name: z.string().min(1).max(64),
  /** uint32 seed used by randomize; stored so a result is reproducible. */
  seed: z.number().int().min(0).max(4294967295),
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
 * v`N+1`. Empty while the format is at version 1. A version bump adds an entry here and a
 * fixture test built from the previous version.
 */
export const CHARACTER_MIGRATIONS: Readonly<
  Record<number, CharacterMigration>
> = {};

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

/** Body of the shipped default character (REQ-CMP-036). */
export const DEFAULT_BODY_REF: AssetRef = 'builtin:quaternius-ubc/superhero-m';

/** Default tint colors; every slot is required. */
const DEFAULT_TINTS: CharacterSpec['tints'] = {
  skin: '#e0ac8a',
  hair: '#4a3222',
  eyes: '#3b5b8c',
  primary: '#5b7fa6',
  secondary: '#a65b5b',
  metal: '#a8afb5',
  leather: '#7a5230',
};

/**
 * Default `CharacterSpec` (REQ-CMP-036, spec 001 Data & contracts): body `superhero-m`, every
 * anatomy value 1, `seed: 0`. `parts` is empty until the M1-14 pack configs fix the hair and
 * outfit part IDs; the data file that fills it must keep every ref registered and compatible.
 */
export function createDefaultCharacterSpec(): CharacterSpec {
  return {
    format: 'sprite-character',
    version: CHARACTER_FORMAT_VERSION,
    name: 'New character',
    seed: 0,
    body: {ref: DEFAULT_BODY_REF},
    parts: {},
    anatomy: defaultAnatomy(),
    morphs: {},
    tints: {...DEFAULT_TINTS},
  };
}
