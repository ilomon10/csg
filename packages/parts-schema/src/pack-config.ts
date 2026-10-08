import {z} from 'zod';
import {bodyRegionSchema, tintModeSchema, tintSlotSchema} from './body';
import {clipCategorySchema, clipIdSchema, entryIssues} from './clip-manifest';
import {bundledLicenseSchema} from './license';
import {partSocketSchema} from './part-manifest';
import {
  bodyTypeSchema,
  packIdSchema,
  partIdSchema,
  rigIdSchema,
  skeletonGroupIdSchema,
  slotIdSchema,
} from './primitives';
import type {SchemaResult} from './primitives';

/**
 * Source file path relative to the pack's `dir` in `tools/asset-sources.json` (spec 011).
 * Vendor folder names may contain spaces and brackets; no `..`, no scheme, no leading slash.
 */
const sourcePathSchema = z
  .string()
  .refine(
    value =>
      value.length > 0 &&
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !/^[A-Za-z]:/.test(value) &&
      !value.split('/').some(segment => segment === '..' || segment === ''),
    {
      error:
        'must be a path relative to the pack dir, without ".." or a scheme',
    },
  );

const unique = (values: readonly string[]) =>
  new Set(values).size === values.length;

/** Authored part entry of a pack config (spec 011). Computed fields are not allowed here. */
export const packConfigPartSchema = z
  .strictObject({
    id: partIdSchema,
    match: z.strictObject({
      /** Relative to the pack's `dir`. */
      file: sourcePathSchema,
      node: z.string().min(1).optional(),
    }),
    name: z.string().min(1),
    slot: slotIdSchema,
    hides: z.array(bodyRegionSchema),
    alsoOccupies: z.array(slotIdSchema).optional(),
    tintSlots: z.array(
      z.strictObject({
        material: z.string().min(1),
        slot: tintSlotSchema,
        mode: tintModeSchema.optional(),
      }),
    ),
    /** Body slot only: the fit group outfits target. */
    bodyType: bodyTypeSchema.optional(),
    bodies: z.array(partIdSchema).optional(),
    bodyTypes: z.array(bodyTypeSchema).optional(),
    /** Body slot only: skeleton group whose rest pose drives characters using this body. */
    characterSkeletonGroup: skeletonGroupIdSchema.optional(),
    socket: partSocketSchema.optional(),
    tags: z.array(z.string().min(1)),
    license: bundledLicenseSchema.optional(),
  })
  .superRefine((part, ctx) => {
    const fail = (path: string[], message: string) =>
      ctx.addIssue({code: 'custom', path, message});
    if (part.bodyType !== undefined && part.slot !== 'body') {
      fail(['bodyType'], 'bodyType is only valid in slot "body"');
    }
    if (part.characterSkeletonGroup !== undefined && part.slot !== 'body') {
      fail(
        ['characterSkeletonGroup'],
        'characterSkeletonGroup is only valid in slot "body"',
      );
    }
    if (part.alsoOccupies !== undefined) {
      if (part.alsoOccupies.includes(part.slot)) {
        fail(
          ['alsoOccupies'],
          `alsoOccupies must not repeat own slot "${part.slot}"`,
        );
      }
      if (!unique(part.alsoOccupies))
        fail(['alsoOccupies'], 'alsoOccupies has duplicates');
    }
    if (!unique(part.hides)) fail(['hides'], 'hides has duplicates');
  });

/** Authored clip entry of a pack config. */
export const packConfigClipSchema = z.strictObject({
  id: clipIdSchema,
  match: z.strictObject({
    /** Relative to the pack's `dir`. */
    file: sourcePathSchema,
    /** Animation name inside the source file (becomes `sourceName`). */
    animation: z.string().min(1),
  }),
  name: z.string().min(1),
  category: clipCategorySchema,
  loop: z.boolean(),
  defaultFrameCount: z.number().int().min(1).max(64),
  inPlaceVariant: clipIdSchema.optional(),
  tags: z.array(z.string().min(1)),
  license: bundledLicenseSchema.optional(),
});

/** `tools/packs/<packId>/pack.config.json` (authored, committed; spec 011 Data & contracts). */
export const packConfigSchema = z
  .strictObject({
    format: z.literal('sprite-pack-config'),
    version: z.literal(1),
    packId: packIdSchema,
    name: z.string().min(1),
    license: bundledLicenseSchema,
    rig: rigIdSchema,
    parts: z.array(packConfigPartSchema),
    clips: z.array(packConfigClipSchema),
  })
  .superRefine((config, ctx) => {
    for (const list of ['parts', 'clips'] as const) {
      const ids = new Set<string>();
      config[list].forEach((entry, i) => {
        if (ids.has(entry.id)) {
          ctx.addIssue({
            code: 'custom',
            path: [list, i, 'id'],
            message: `duplicate ${list === 'parts' ? 'part' : 'clip'} id "${entry.id}"`,
          });
        }
        ids.add(entry.id);
      });
    }
    config.clips.forEach((clip, i) => {
      if (
        clip.inPlaceVariant !== undefined &&
        !config.clips.some(other => other.id === clip.inPlaceVariant)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['clips', i, 'inPlaceVariant'],
          message: `inPlaceVariant "${clip.inPlaceVariant}" is not in clips`,
        });
      }
    });
  });

/** Inferred type of {@link packConfigSchema}. */
export type PackConfig = z.infer<typeof packConfigSchema>;

/**
 * Validates a parsed pack config; never throws. Issues name the owning part or clip ID (the
 * pack ID for pack-level fields) and the failing field.
 */
export function parsePackConfig(json: unknown): SchemaResult<PackConfig> {
  const parsed = packConfigSchema.safeParse(json);
  if (parsed.success) return {ok: true, value: parsed.data};
  const issues = entryIssues(parsed.error, json, ['parts', 'clips']);
  return {ok: false, issues};
}
