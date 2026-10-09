import {z} from 'zod';

/** Current version of the persisted `sprite-character` document format (REQ-CMP-038). */
export const CHARACTER_FORMAT_VERSION = 2;

/** Body styles, in picker order (REQ-CMP-038). A closed set: unknown values are rejected (REQ-CMP-040). */
export const CHARACTER_STYLES = [
  'realistic',
  'chibi',
  'stickman',
  'voxel',
] as const;

/** A body style. */
export type CharacterStyle = (typeof CHARACTER_STYLES)[number];

/** Species, in picker order (REQ-CMP-038). A closed set: unknown values are rejected (REQ-CMP-040). */
export const CHARACTER_SPECIES = ['human', 'animal', 'monster'] as const;

/** A species. */
export type CharacterSpecies = (typeof CHARACTER_SPECIES)[number];

/** Strict enum of {@link CHARACTER_STYLES}: no coercion, no case folding (REQ-CMP-040). */
export const characterStyleSchema = z.enum(CHARACTER_STYLES);

/** Strict enum of {@link CHARACTER_SPECIES}: no coercion, no case folding (REQ-CMP-040). */
export const characterSpeciesSchema = z.enum(CHARACTER_SPECIES);

/** Hex sRGB color such as `#a0c4ff`. Parsing normalizes to lowercase (spec 001). */
export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .transform(value => value.toLowerCase());

/** Inferred type of {@link hexColorSchema}: lowercase `#rrggbb`. */
export type HexColor = z.infer<typeof hexColorSchema>;

/** Lowercase hex SHA-256 digest (64 characters). */
export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, {
  error: 'must be a lowercase 64-character hex SHA-256',
});

/** Semantic-version-like string: `1.2.3`, optionally with `-pre` and `+build`. */
export const semverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/, {
    error: 'must look like 1.2.3',
  });

/** Rig ID such as `quaternius-ue5-65`: `[a-z0-9-]{1,64}`. */
export const rigIdSchema = z.string().regex(/^[a-z0-9-]{1,64}$/, {
  error: issue =>
    `invalid rig id ${JSON.stringify(issue.input)}: must match [a-z0-9-]{1,64}`,
});

/** Inferred type of {@link rigIdSchema}. */
export type RigId = z.infer<typeof rigIdSchema>;

/** Slot ID such as `prop-main-hand`: `[a-z0-9-]{1,32}`. Validated against the registry elsewhere. */
export const slotIdSchema = z.string().regex(/^[a-z0-9-]{1,32}$/, {
  error: issue =>
    `invalid slot id ${JSON.stringify(issue.input)}: must match [a-z0-9-]{1,32}`,
});

/** Inferred type of {@link slotIdSchema}. */
export type SlotId = z.infer<typeof slotIdSchema>;

/** Pack ID such as `quaternius-ubc`: `[a-z0-9-]{1,64}`. */
export const packIdSchema = z.string().regex(/^[a-z0-9-]{1,64}$/, {
  error: issue =>
    `invalid pack id ${JSON.stringify(issue.input)}: must match [a-z0-9-]{1,64}`,
});

/** Part ID, stable and never reused within a pack: `[a-z0-9-]{1,64}`. */
export const partIdSchema = z.string().regex(/^[a-z0-9-]{1,64}$/, {
  error: issue =>
    `invalid part id ${JSON.stringify(issue.input)}: must match [a-z0-9-]{1,64}`,
});

/** Body fit-group ID such as `superhero` or `regular`: `[a-z0-9-]{1,32}`. */
export const bodyTypeSchema = z.string().regex(/^[a-z0-9-]{1,32}$/, {
  error: issue =>
    `invalid body type ${JSON.stringify(issue.input)}: must match [a-z0-9-]{1,32}`,
});

/** Skeleton group ID such as `superhero-m` (spec 011 REQ-AST-026): `[a-z0-9-]{1,32}`. */
export const skeletonGroupIdSchema = z.string().regex(/^[a-z0-9-]{1,32}$/, {
  error: issue =>
    `invalid skeleton group id ${JSON.stringify(issue.input)}: must match [a-z0-9-]{1,32}`,
});

/** Inferred type of {@link skeletonGroupIdSchema}. */
export type SkeletonGroupId = z.infer<typeof skeletonGroupIdSchema>;

/** Reference to a part or decal: `builtin:<packId>/<partId>` or `user:<id>`. */
export const assetRefSchema = z
  .string()
  .regex(
    /^(builtin:[a-z0-9-]{1,64}\/[a-z0-9-]{1,64}|user:[A-Za-z0-9-]{1,64})$/,
    {
      error: 'must be builtin:<packId>/<partId> or user:<id>',
    },
  );

/** Inferred type of {@link assetRefSchema}. */
export type AssetRef = z.infer<typeof assetRefSchema>;

/** Reference to a clip: `builtin:<packId>/<clipId>` or `user:<id>#<clipId>` (spec 004). */
export const clipRefSchema = z
  .string()
  .regex(
    /^(builtin:[a-z0-9-]{1,64}\/[a-z0-9-]{1,64}|user:[A-Za-z0-9-]{1,64}#[A-Za-z0-9_.:-]{1,64})$/,
    {error: 'must be builtin:<packId>/<clipId> or user:<id>#<clipId>'},
  );

/** Inferred type of {@link clipRefSchema}. */
export type ClipRef = z.infer<typeof clipRefSchema>;

const finite = z.number().finite();

/** Position, Euler rotation in degrees (XYZ) and scale of a socketed prop. */
export const transformOffsetSchema = z.object({
  position: z.tuple([finite, finite, finite]),
  rotationDeg: z.tuple([finite, finite, finite]),
  scale: z.tuple([finite, finite, finite]),
});

/** Inferred type of {@link transformOffsetSchema}. */
export type TransformOffset = z.infer<typeof transformOffsetSchema>;

/** A validation problem with a printable path and, for manifests, the owning entry ID. */
export interface SchemaIssue {
  /** Dotted path into the input, e.g. `parts.2.license.author`. Empty for the root. */
  path: string;
  message: string;
  /** Part ID (or pack ID for pack-level fields) that owns the problem. */
  entryId?: string;
  /** Last path segment that is a field name, e.g. `author`. */
  field?: string;
}

/** Result of a schema-level load that never throws. */
export type SchemaResult<T> =
  {ok: true; value: T} | {ok: false; issues: SchemaIssue[]};

/** Formats a Zod issue path as a dotted string. */
export function formatPath(path: ReadonlyArray<PropertyKey>): string {
  return path.map(String).join('.');
}

/** Converts a Zod error to {@link SchemaIssue}s without entry attribution. */
export function toSchemaIssues(error: z.ZodError): SchemaIssue[] {
  return error.issues.map(issue => {
    const last = issue.path[issue.path.length - 1];
    return {
      path: formatPath(issue.path),
      message: issue.message,
      ...(typeof last === 'string' ? {field: last} : {}),
    };
  });
}
