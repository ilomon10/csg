import {z} from 'zod';
import {
  bodyRegionSchema,
  socketIdSchema,
  tintModeSchema,
  tintSlotSchema,
} from './body';
import {bundledLicenseSchema} from './license';
import {
  bodyTypeSchema,
  formatPath,
  packIdSchema,
  partIdSchema,
  rigIdSchema,
  sha256Schema,
  skeletonGroupIdSchema,
  slotIdSchema,
  transformOffsetSchema,
} from './primitives';
import type {SchemaIssue, SchemaResult} from './primitives';
import {rigDefinitionSchema} from './rig';
import type {RigDefinition} from './rig';
import type {SlotRegistry} from './slots';

/** Where a static part attaches (spec 001/002). */
export const partSocketSchema = z.object({
  bone: socketIdSchema,
  offset: transformOffsetSchema,
  /** Whether the prop follows the socket joint's anatomy scale. */
  inheritScale: z.boolean().optional(),
});

/** Inferred type of {@link partSocketSchema}. */
export type PartSocket = z.infer<typeof partSocketSchema>;

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

const unique = (values: readonly string[]) =>
  new Set(values).size === values.length;

/**
 * One part of a pack (spec 001 Data & contracts). Computed fields (`file`, `sha256`, `stats`,
 * `thumbnail`) are written by build-parts. Unknown fields round-trip (loose object).
 */
export const partEntrySchema = z
  .looseObject({
    /** Stable within the pack; never reused (retired-ids.json). */
    id: partIdSchema,
    name: z.string().min(1),
    slot: slotIdSchema,
    kind: z.enum(['skinned', 'static']),
    file: packPathSchema,
    node: z.string().min(1).optional(),
    /** Required for `skinned` parts. */
    rig: rigIdSchema.optional(),
    /** Computed by build-parts: skeleton group of the file (spec 011 REQ-AST-026); skinned parts. */
    skeletonGroup: skeletonGroupIdSchema.optional(),
    /** Authored, slot `body` only: group whose rest pose builds the character skeleton (REQ-CMP-037). */
    characterSkeletonGroup: skeletonGroupIdSchema.optional(),
    /** Only for parts in slot `body`: the fit group outfits target. */
    bodyType: bodyTypeSchema.optional(),
    hides: z.array(bodyRegionSchema),
    alsoOccupies: z.array(slotIdSchema).optional(),
    tintSlots: z.array(
      z.object({
        material: z.string().min(1),
        slot: tintSlotSchema,
        mode: tintModeSchema.optional(),
      }),
    ),
    /** Required for `static` parts. */
    socket: partSocketSchema.optional(),
    /** Body part IDs this part fits; empty or absent means all. */
    bodies: z.array(partIdSchema).optional(),
    /** Body fit groups this part fits; empty or absent means all. */
    bodyTypes: z.array(bodyTypeSchema).optional(),
    thumbnail: packPathSchema.optional(),
    sha256: sha256Schema,
    stats: z.object({
      triangles: z.number().int().min(0),
      textures: z.number().int().min(0),
    }),
    tags: z.array(z.string().min(1)),
    /** Overrides the pack license; must still be bundlable with author and source URL. */
    license: bundledLicenseSchema.optional(),
  })
  .superRefine((part, ctx) => {
    const fail = (path: string[], message: string) =>
      ctx.addIssue({code: 'custom', path, message});
    if (part.kind === 'skinned' && part.rig === undefined) {
      fail(['rig'], 'skinned part requires rig');
    }
    if (part.kind === 'static' && part.socket === undefined) {
      fail(['socket'], 'static part requires socket');
    }
    if (part.bodyType !== undefined && part.slot !== 'body') {
      fail(['bodyType'], 'bodyType is only valid in slot "body"');
    }
    if (part.characterSkeletonGroup !== undefined && part.slot !== 'body') {
      fail(
        ['characterSkeletonGroup'],
        `${part.id}: characterSkeletonGroup is only valid in slot "body"`,
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

/** Inferred type of {@link partEntrySchema}. */
export type PartEntry = z.infer<typeof partEntrySchema>;

/** `assets/packs/<packId>/manifest.json` (spec 011 REQ-AST-013). Generated; never hand-edited. */
export const partManifestSchema = z
  .looseObject({
    format: z.literal('sprite-parts-manifest'),
    version: z.literal(1),
    packId: packIdSchema,
    name: z.string().min(1),
    license: bundledLicenseSchema,
    rigs: z.array(rigDefinitionSchema),
    parts: z.array(partEntrySchema),
  })
  .superRefine((manifest, ctx) => {
    const rigIds = new Set<string>();
    manifest.rigs.forEach((rig, i) => {
      if (rigIds.has(rig.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['rigs', i, 'id'],
          message: `duplicate rig id "${rig.id}"`,
        });
      }
      rigIds.add(rig.id);
    });
    const ids = new Set<string>();
    manifest.parts.forEach((part, i) => {
      if (ids.has(part.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['parts', i, 'id'],
          message: `duplicate part id "${part.id}"`,
        });
      }
      ids.add(part.id);
      if (part.rig !== undefined && !rigIds.has(part.rig)) {
        ctx.addIssue({
          code: 'custom',
          path: ['parts', i, 'rig'],
          message: `rig "${part.rig}" is not in rigs`,
        });
      }
    });
  });

/** Inferred type of {@link partManifestSchema}. */
export type PartManifest = z.infer<typeof partManifestSchema>;

/**
 * Validates a parsed manifest; never throws. Each issue names the owning part ID (or the pack
 * ID for pack-level fields) and the failing field (AC-GEN-008.1, AC-AST-017.2).
 */
export function parsePartManifest(json: unknown): SchemaResult<PartManifest> {
  const parsed = partManifestSchema.safeParse(json);
  if (parsed.success) return {ok: true, value: parsed.data};
  const root =
    typeof json === 'object' && json !== null
      ? (json as Record<string, unknown>)
      : {};
  const parts = Array.isArray(root['parts'])
    ? (root['parts'] as unknown[])
    : [];
  const packId =
    typeof root['packId'] === 'string' ? root['packId'] : undefined;
  const issues = parsed.error.issues.map((issue): SchemaIssue => {
    const [head, index] = issue.path;
    const last = issue.path[issue.path.length - 1];
    let entryId = packId;
    if (head === 'parts' && typeof index === 'number') {
      const part = parts[index];
      const id =
        typeof part === 'object' && part !== null
          ? (part as {id?: unknown}).id
          : undefined;
      entryId = typeof id === 'string' ? id : `parts[${index}]`;
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
  return {ok: false, issues};
}

/**
 * Checks every part against the slot registry: the slot exists, the part's `kind` is allowed
 * there (AC-CMP-003.2), and `alsoOccupies` names known slots. Issues name the part ID.
 */
export function validatePartsAgainstSlots(
  manifest: Pick<PartManifest, 'parts'>,
  registry: SlotRegistry,
): SchemaResult<true> {
  const slots = new Map(registry.slots.map(slot => [slot.id, slot]));
  const issues: SchemaIssue[] = [];
  manifest.parts.forEach((part, i) => {
    const report = (field: string, message: string) =>
      issues.push({
        path: `parts.${i}.${field}`,
        message: `${part.id}: ${message}`,
        entryId: part.id,
        field,
      });
    const slot = slots.get(part.slot);
    if (slot === undefined) {
      report('slot', `unknown slot "${part.slot}"`);
    } else if (!slot.kinds.includes(part.kind)) {
      report('kind', `slot "${slot.id}" does not accept ${part.kind} parts`);
    }
    for (const other of part.alsoOccupies ?? []) {
      if (!slots.has(other)) report('alsoOccupies', `unknown slot "${other}"`);
    }
  });
  return issues.length === 0 ? {ok: true, value: true} : {ok: false, issues};
}

/**
 * Checks skeleton groups against the embedded rigs (AC-CMP-037.3, AC-AST-026.x): a skinned
 * part's rig exists, and its `skeletonGroup` / `characterSkeletonGroup` name a group of that
 * rig. Issues name the part ID and the field.
 */
export function validatePartsAgainstRig(
  manifest: Pick<PartManifest, 'parts' | 'rigs'>,
  rig?: Pick<RigDefinition, 'id' | 'skeletonGroups'>,
): SchemaResult<true> {
  const rigs = new Map<string, Pick<RigDefinition, 'id' | 'skeletonGroups'>>(
    manifest.rigs.map(r => [r.id, r]),
  );
  if (rig !== undefined) rigs.set(rig.id, rig);
  const issues: SchemaIssue[] = [];
  manifest.parts.forEach((part, i) => {
    const report = (field: string, message: string) =>
      issues.push({
        path: `parts.${i}.${field}`,
        message: `${part.id}: ${message}`,
        entryId: part.id,
        field,
      });
    const partRig = part.rig === undefined ? undefined : rigs.get(part.rig);
    if (part.kind === 'skinned' && partRig === undefined) {
      report('rig', `rig "${part.rig ?? ''}" does not exist`);
    }
    for (const field of ['skeletonGroup', 'characterSkeletonGroup'] as const) {
      const id = part[field];
      if (id === undefined || partRig === undefined) continue;
      if (!partRig.skeletonGroups.some(group => group.id === id)) {
        report(field, `unknown skeleton group "${id}" in rig "${partRig.id}"`);
      }
    }
  });
  return issues.length === 0 ? {ok: true, value: true} : {ok: false, issues};
}
