import {z} from 'zod';
import {bundledLicenseSchema} from './license';
import {
  formatPath,
  packIdSchema,
  rigIdSchema,
  sha256Schema,
  skeletonGroupIdSchema,
} from './primitives';
import type {SchemaIssue, SchemaResult} from './primitives';

/** Clip categories shown in the animation panel (spec 004 REQ-ANM-001). */
export const CLIP_CATEGORIES = [
  'locomotion',
  'combat',
  'reaction',
  'death',
  'emote',
  'misc',
] as const;

/** Zod enum of {@link CLIP_CATEGORIES}. */
export const clipCategorySchema = z.enum(CLIP_CATEGORIES);

/** A clip category such as `locomotion`. */
export type ClipCategory = z.infer<typeof clipCategorySchema>;

/** Clip ID, stable and never reused within a pack: `[a-z0-9-]{1,64}`. */
export const clipIdSchema = z.string().regex(/^[a-z0-9-]{1,64}$/, {
  error: issue =>
    `invalid clip id ${JSON.stringify(issue.input)}: must match [a-z0-9-]{1,64}`,
});

/** Relative, forward-slash path inside a pack: no `..`, no scheme, no leading slash. */
const packPathSchema = z
  .string()
  .refine(
    value =>
      value.length > 0 &&
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !value.includes(':') &&
      !value.split('/').some(segment => segment === '..' || segment === ''),
    {error: 'must be a relative path inside the pack'},
  );

/**
 * One clip of a pack (spec 004 Data & contracts). Computed fields (`file`, `rig`,
 * `durationSec`, `hasRootMotion`, `sha256`, `skeletonGroup`) are written by build-parts.
 * `sha256` and `skeletonGroup` are required: the registry caches by URL and `sha256`
 * (REQ-ANM-021), and every built clip names its skeleton group (REQ-AST-026).
 * Unknown fields round-trip (loose object).
 */
export const clipEntrySchema = z
  .looseObject({
    /** Stable within the pack; never reused (retired-ids.json). */
    id: clipIdSchema,
    name: z.string().min(1),
    category: clipCategorySchema,
    file: packPathSchema,
    /** Animation name inside the GLB. */
    sourceName: z.string().min(1),
    rig: rigIdSchema,
    durationSec: z.number().finite().positive(),
    loop: z.boolean(),
    defaultFrameCount: z.number().int().min(1).max(64),
    hasRootMotion: z.boolean(),
    /** Clip id of the in-place variant. */
    inPlaceVariant: clipIdSchema.optional(),
    tags: z.array(z.string().min(1)),
    /** Overrides the pack license; must still be bundlable with author and source URL. */
    license: bundledLicenseSchema.optional(),
    sha256: sha256Schema,
    skeletonGroup: skeletonGroupIdSchema,
  })
  .superRefine((clip, ctx) => {
    if (clip.inPlaceVariant === clip.id) {
      ctx.addIssue({
        code: 'custom',
        path: ['inPlaceVariant'],
        message: 'inPlaceVariant must not name the clip itself',
      });
    }
  });

/** Inferred type of {@link clipEntrySchema}. */
export type ClipEntry = z.infer<typeof clipEntrySchema>;

/** `assets/packs/<packId>/clips.json` (spec 011 REQ-AST-013). Generated; never hand-edited. */
export const clipManifestSchema = z
  .looseObject({
    format: z.literal('sprite-clips-manifest'),
    version: z.literal(1),
    packId: packIdSchema,
    name: z.string().min(1),
    license: bundledLicenseSchema,
    clips: z.array(clipEntrySchema),
  })
  .superRefine((manifest, ctx) => {
    const ids = new Set<string>();
    manifest.clips.forEach((clip, i) => {
      if (ids.has(clip.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['clips', i, 'id'],
          message: `duplicate clip id "${clip.id}"`,
        });
      }
      ids.add(clip.id);
    });
    manifest.clips.forEach((clip, i) => {
      if (clip.inPlaceVariant !== undefined && !ids.has(clip.inPlaceVariant)) {
        ctx.addIssue({
          code: 'custom',
          path: ['clips', i, 'inPlaceVariant'],
          message: `inPlaceVariant "${clip.inPlaceVariant}" is not in clips`,
        });
      }
    });
  });

/** Inferred type of {@link clipManifestSchema}. */
export type ClipManifest = z.infer<typeof clipManifestSchema>;

/**
 * Turns Zod issues into {@link SchemaIssue}s whose message starts with the owning entry ID
 * (the item of one of the `lists` arrays at `path[1]`) or the pack ID for pack-level fields
 * (AC-ANM-001.2).
 */
export function entryIssues(
  error: z.ZodError,
  json: unknown,
  lists: readonly string[],
): SchemaIssue[] {
  const root =
    typeof json === 'object' && json !== null
      ? (json as Record<string, unknown>)
      : {};
  const packId =
    typeof root['packId'] === 'string' ? root['packId'] : undefined;
  return error.issues.map((issue): SchemaIssue => {
    const [head, index] = issue.path;
    const last = issue.path[issue.path.length - 1];
    let entryId = packId;
    if (
      typeof head === 'string' &&
      lists.includes(head) &&
      typeof index === 'number'
    ) {
      const items = root[head];
      const item = Array.isArray(items) ? (items[index] as unknown) : undefined;
      const id =
        typeof item === 'object' && item !== null
          ? (item as {id?: unknown}).id
          : undefined;
      entryId = typeof id === 'string' ? id : `${head}[${index}]`;
    }
    const path = formatPath(issue.path);
    return {
      path,
      message:
        entryId === undefined
          ? `${path}: ${issue.message}`
          : `${entryId}: ${path}: ${issue.message}`,
      ...(entryId === undefined ? {} : {entryId}),
      ...(typeof last === 'string' ? {field: last} : {}),
    };
  });
}

/**
 * Validates a parsed clip manifest; never throws. Each issue names the owning clip ID and the
 * failing field (AC-ANM-001.2).
 */
export function parseClipManifest(json: unknown): SchemaResult<ClipManifest> {
  const parsed = clipManifestSchema.safeParse(json);
  if (parsed.success) return {ok: true, value: parsed.data};
  return {ok: false, issues: entryIssues(parsed.error, json, ['clips'])};
}
