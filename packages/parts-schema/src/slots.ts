import './zod-config';
import {z} from 'zod';
import slotsJson from '../data/slots.json';
import {socketIdSchema} from './body';
import {slotIdSchema, toSchemaIssues} from './primitives';
import type {SchemaResult} from './primitives';

/** The 15 v1 slot IDs in display order (spec 001 REQ-CMP-001). */
export const V1_SLOT_IDS = [
  'body',
  'hair',
  'eyebrows',
  'beard',
  'face',
  'headwear',
  'torso',
  'arms',
  'hands',
  'legs',
  'feet',
  'back',
  'accessory',
  'prop-main-hand',
  'prop-off-hand',
] as const;

/** A slot of the registry (spec 001 Data & contracts). */
export const slotDefinitionSchema = z.object({
  id: slotIdSchema,
  /** i18n message key. */
  label: z.string().min(1),
  /** Display order, ascending. */
  order: z.number().int().min(0),
  kinds: z.array(z.enum(['skinned', 'static'])).min(1),
  /** True only for `body`. */
  required: z.boolean(),
  defaultSocket: socketIdSchema.optional(),
  randomize: z.object({emptyChance: z.number().min(0).max(1)}),
});

/** Inferred type of {@link slotDefinitionSchema}. */
export type SlotDefinition = z.infer<typeof slotDefinitionSchema>;

/**
 * The slot registry data file (`data/slots.json`). Slots are data (P-11), so any number of
 * slots is valid; the v1 file lists {@link V1_SLOT_IDS}.
 */
export const slotRegistrySchema = z
  .object({
    format: z.literal('sprite-slot-registry'),
    version: z.literal(1),
    slots: z.array(slotDefinitionSchema).min(1),
  })
  .superRefine((registry, ctx) => {
    const seen = new Set<string>();
    registry.slots.forEach((slot, index) => {
      if (seen.has(slot.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['slots', index, 'id'],
          message: `duplicate slot id "${slot.id}"`,
        });
      }
      seen.add(slot.id);
      if (slot.required !== (slot.id === 'body')) {
        ctx.addIssue({
          code: 'custom',
          path: ['slots', index, 'required'],
          message: `slot "${slot.id}": only "body" is required`,
        });
      }
      const previous = registry.slots[index - 1];
      if (previous && slot.order <= previous.order) {
        ctx.addIssue({
          code: 'custom',
          path: ['slots', index, 'order'],
          message: `slot "${slot.id}": order must be greater than the previous slot's`,
        });
      }
    });
  });

/** Inferred type of {@link slotRegistrySchema}. */
export type SlotRegistry = z.infer<typeof slotRegistrySchema>;

/** Validates a parsed slot registry; never throws. Error messages name the offending slot ID. */
export function loadSlotRegistry(json: unknown): SchemaResult<SlotRegistry> {
  const parsed = slotRegistrySchema.safeParse(json);
  return parsed.success
    ? {ok: true, value: parsed.data}
    : {ok: false, issues: toSchemaIssues(parsed.error)};
}

/**
 * The validated bundled slot registry (`data/slots.json`, REQ-CMP-001), parsed once at module
 * load (throws if the file is invalid). Slots are data (P-11): consumers read it instead of
 * importing the JSON file.
 */
export const SLOT_REGISTRY: SlotRegistry = slotRegistrySchema.parse(slotsJson);
