import {z} from 'zod';
import {formatPath} from './primitives';
import type {SchemaIssue} from './primitives';

/** Scale factors an export may include (REQ-EXP-009). */
export const EXPORT_SCALES = [1, 2, 4, 8] as const;

/** One export scale factor. */
export type ExportScale = (typeof EXPORT_SCALES)[number];

const scaleSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(4),
  z.literal(8),
]);

/**
 * Auxiliary lighting maps (spec 012 `LightingMapSettings`, REQ-LIT-020). Every kind defaults to
 * off. Rendering belongs to M6; the schema keeps the field so projects round-trip.
 */
export const lightingMapSettingsSchema = z.object({
  normal: z.boolean().default(false),
  albedo: z.boolean().default(false),
  mask: z.boolean().default(false),
  specular: z.boolean().default(false),
  uv: z.boolean().default(false),
  depth: z.boolean().default(false),
  emission: z.boolean().default(false),
  normalConvention: z.enum(['y-up', 'y-down']).default('y-up'),
  /** Odd integer 3..63; absent means no quantization (REQ-LIT-030). */
  quantizeNormals: z
    .number()
    .int()
    .min(3)
    .max(63)
    .refine(value => value % 2 === 1, {error: 'must be odd'})
    .optional(),
  uvPrecision: z.union([z.literal(8), z.literal(16)]).optional(),
  depthPrecision: z.union([z.literal(8), z.literal(16)]).optional(),
  specularDefault: z
    .object({
      intensity: z.number().min(0).max(1),
      shininess: z.number().min(0).max(1),
    })
    .optional(),
});

/** Inferred type of {@link lightingMapSettingsSchema}. */
export type LightingMapSettings = z.infer<typeof lightingMapSettingsSchema>;

/**
 * Persisted sprite sheet export options (spec 005 Data & contracts). Defaults are filled on
 * parse; `scales` must be non-empty, unique and ascending (AC-EXP-009.2) and `paddingPx` must be
 * at least `2 * extrudePx` (AC-EXP-008.1).
 */
export const exportSettingsSchema = z
  .object({
    /** Optional base-name override; sanitized per REQ-EXP-016 at export time. */
    baseName: z.string().min(1).max(64).optional(),
    layout: z
      .enum(['grid-by-animation', 'strip-per-animation', 'frames-zip'])
      .default('grid-by-animation'),
    rowOrder: z.enum(['clip-major', 'direction-major']).default('clip-major'),
    /** Wrap rows after N frames (1..256); `null` means no wrap (REQ-EXP-004). */
    maxColumns: z.number().int().min(1).max(256).nullable().default(null),
    scales: z
      .array(scaleSchema)
      .min(1)
      .refine(
        list => list.every((value, i) => i === 0 || value > (list[i - 1] ?? 0)),
        {error: 'scales must be unique and ascending'},
      )
      .default([1]),
    paddingPx: z.number().int().min(0).max(16).default(0),
    marginPx: z.number().int().min(0).max(16).default(0),
    powerOfTwo: z.boolean().default(false),
    extrudePx: z.number().int().min(0).max(2).default(0),
    metadata: z
      .enum(['none', 'json', 'aseprite-json'])
      .default('aseprite-json'),
    pngColorType: z.enum(['rgba', 'indexed']).default('rgba'),
    enginePreset: z
      .enum(['none', 'godot4', 'phaser3', 'unity', 'tiled'])
      .default('none'),
    previews: z
      .object({
        gif: z.boolean().default(false),
        apng: z.boolean().default(false),
        scale: scaleSchema.default(2),
      })
      .default({gif: false, apng: false, scale: 2}),
    /** Absent means no maps (spec 012 REQ-LIT-020). */
    maps: lightingMapSettingsSchema.optional(),
    /** Credits always travel with the sprites (REQ-EXP-020). */
    includeCredits: z.literal(true).default(true),
  })
  .superRefine((settings, ctx) => {
    if (settings.paddingPx < 2 * settings.extrudePx) {
      ctx.addIssue({
        code: 'custom',
        path: ['paddingPx'],
        message: 'paddingPx must be at least 2 * extrudePx',
      });
    }
  });

/** Inferred type of {@link exportSettingsSchema} (all defaults filled). */
export type ExportSettings = z.output<typeof exportSettingsSchema>;

/** Result of {@link parseExportSettings}; the failure carries code `EXP_INVALID_SETTINGS`. */
export type ExportSettingsResult =
  | {ok: true; value: ExportSettings}
  | {ok: false; code: 'EXP_INVALID_SETTINGS'; issues: SchemaIssue[]};

/**
 * Default export settings (spec 005): grid-by-animation, clip-major, one wrap-free row set at
 * scale 1, no padding, Aseprite JSON plus manifest, RGBA PNG, no previews.
 */
export function defaultExportSettings(): ExportSettings {
  return exportSettingsSchema.parse({});
}

/**
 * Validates and normalizes export settings, filling defaults for absent fields. Never throws;
 * every failing path comes back in `issues` under `EXP_INVALID_SETTINGS` (REQ-EXP-008/009).
 */
export function parseExportSettings(json: unknown): ExportSettingsResult {
  const parsed = exportSettingsSchema.safeParse(json);
  if (parsed.success) return {ok: true, value: parsed.data};
  return {
    ok: false,
    code: 'EXP_INVALID_SETTINGS',
    issues: parsed.error.issues.map(issue => {
      const last = issue.path[issue.path.length - 1];
      return {
        path: formatPath(issue.path),
        message: issue.message,
        ...(typeof last === 'string' ? {field: last} : {}),
      };
    }),
  };
}
