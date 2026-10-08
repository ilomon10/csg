import {z} from 'zod';

/** Hex sRGB color such as `#a0c4ff`. */
export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Inferred type of {@link hexColorSchema}. */
export type HexColor = z.infer<typeof hexColorSchema>;

/** Current version of the persisted `sprite-character` document format. */
export const CHARACTER_FORMAT_VERSION = 1;
