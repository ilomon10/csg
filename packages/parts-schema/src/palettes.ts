import {z} from 'zod';
import endesga32Json from '../data/palettes/endesga-32.json';
import pico8Json from '../data/palettes/pico-8.json';
import {hexColorSchema, toSchemaIssues} from './primitives';
import type {HexColor, SchemaResult} from './primitives';

/** Maximum colors of a custom palette (REQ-PIX-019). */
export const MAX_PALETTE_COLORS = 256;

/** Palette preset IDs that ship as data files (REQ-PIX-018). `none` and `custom` are not presets. */
export const PALETTE_PRESET_IDS = ['pico-8', 'endesga-32'] as const;

/** ID of a bundled palette preset. */
export type PalettePresetId = (typeof PALETTE_PRESET_IDS)[number];

/** A palette data file (`data/palettes/<id>.json`). Palettes are data (P-11). */
export const paletteDataSchema = z.object({
  format: z.literal('sprite-palette'),
  version: z.literal(1),
  id: z.enum(PALETTE_PRESET_IDS),
  name: z.string().min(1),
  /** Index order matters: the LUT breaks ties by lowest index (REQ-PIX-021). */
  colors: z.array(hexColorSchema).min(1).max(MAX_PALETTE_COLORS),
  /** Provenance for `ASSETS_LICENSE.md` and `CREDITS.txt` (P-02). */
  source: z.object({
    author: z.string().min(1),
    sourceUrl: z.string().regex(/^https?:\/\/\S+$/),
    note: z.string().min(1),
  }),
});

/** Inferred type of {@link paletteDataSchema}. */
export type PaletteData = z.infer<typeof paletteDataSchema>;

/** Validates one palette data file. */
export function parsePaletteData(json: unknown): SchemaResult<PaletteData> {
  const parsed = paletteDataSchema.safeParse(json);
  return parsed.success
    ? {ok: true, value: parsed.data}
    : {ok: false, issues: toSchemaIssues(parsed.error)};
}

function loadPreset(json: unknown): PaletteData {
  const result = parsePaletteData(json);
  if (!result.ok) {
    throw new Error(
      `invalid palette data file: ${result.issues.map(i => `${i.path}: ${i.message}`).join('; ')}`,
    );
  }
  return result.value;
}

/** The bundled palette presets, keyed by ID. */
export const PALETTE_PRESETS: Readonly<Record<PalettePresetId, PaletteData>> = {
  'pico-8': loadPreset(pico8Json),
  'endesga-32': loadPreset(endesga32Json),
};

/** Converts `#rrggbb` (either case) to sRGB bytes. Returns `null` for anything else. */
export function hexToRgb(hex: string): [number, number, number] | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** Converts sRGB bytes (integers 0..255) to lowercase `#rrggbb`. */
export function rgbToHex(r: number, g: number, b: number): HexColor {
  const byte = (v: number) =>
    Math.min(255, Math.max(0, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

/**
 * Drops duplicate colors, comparing case-insensitively and keeping the first occurrence
 * (REQ-PIX-019). Entries that are not strings pass through untouched so validation can
 * report them.
 */
export function dedupeColors<T>(colors: readonly T[]): {
  kept: T[];
  removed: T[];
} {
  const seen = new Set<string>();
  const kept: T[] = [];
  const removed: T[] = [];
  for (const color of colors) {
    const key = typeof color === 'string' ? color.toLowerCase() : null;
    if (key !== null && seen.has(key)) {
      removed.push(color);
      continue;
    }
    if (key !== null) seen.add(key);
    kept.push(color);
  }
  return {kept, removed};
}
