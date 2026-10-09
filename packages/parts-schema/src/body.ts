import {z} from 'zod';

/**
 * Body regions in canonical order. The index of a region is its `_REGION` vertex-attribute
 * value and its bit in the engine's region mask; shared by tools and engine (architecture 3.2).
 */
export const BODY_REGIONS = [
  'head',
  'hair',
  'neck',
  'torso',
  'upper-arms',
  'lower-arms',
  'hands',
  'pelvis',
  'upper-legs',
  'lower-legs',
  'feet',
] as const;

/** Zod enum of {@link BODY_REGIONS}. */
export const bodyRegionSchema = z.enum(BODY_REGIONS);

/** A body region ID such as `upper-arms`. */
export type BodyRegion = z.infer<typeof bodyRegionSchema>;

/** Color slots a material can be mapped to (spec 001 REQ-CMP-014). */
export const TINT_SLOTS = [
  'skin',
  'hair',
  'eyes',
  'primary',
  'secondary',
  'metal',
  'leather',
] as const;

/** Zod enum of {@link TINT_SLOTS}. */
export const tintSlotSchema = z.enum(TINT_SLOTS);

/** A tint slot ID such as `skin`. */
export type TintSlot = z.infer<typeof tintSlotSchema>;

/** How a tint combines with the texture: `texel.rgb × tint` (white keeps the authored colours), or flat replacement. */
export const tintModeSchema = z.enum(['multiply', 'replace']);

/** A tint mode. */
export type TintMode = z.infer<typeof tintModeSchema>;

/**
 * Semantic socket IDs. A rig maps each to a joint through `RigDefinition.socketBones`
 * (decision D1: source joint names such as `Head` stay unchanged).
 */
export const SOCKET_IDS = [
  'hand_r',
  'hand_l',
  'head',
  'spine_03',
  'pelvis',
] as const;

/** Zod enum of {@link SOCKET_IDS}. */
export const socketIdSchema = z.enum(SOCKET_IDS);

/** A socket ID such as `hand_r`. */
export type SocketId = z.infer<typeof socketIdSchema>;

/** Anatomy controls, in the order of spec 002 REQ-ANA-001. */
export const ANATOMY_PARAM_KEYS = [
  'height',
  'head',
  'torsoWidth',
  'shoulders',
  'armLength',
  'legLength',
  'hands',
  'feet',
  'limbThickness',
] as const;

/** Zod enum of {@link ANATOMY_PARAM_KEYS}. */
export const anatomyParamKeySchema = z.enum(ANATOMY_PARAM_KEYS);

/** An anatomy control key such as `armLength`. */
export type AnatomyParamKey = z.infer<typeof anatomyParamKeySchema>;
