import {z} from 'zod';

/** Warning codes an export may record in its manifest (REQ-EXP-021, 025). */
export const EXPORT_WARNING_CODES = [
  'LICENSE_UNKNOWN',
  'LICENSE_NON_COMMERCIAL',
  'LICENSE_SHARE_ALIKE',
  'EXP_LARGE_TEXTURE',
  'EXP_GIF_TOO_MANY_COLORS',
  'EXP_EMPTY_FRAMES',
  'PIX_FRAMING_CLIPPED',
] as const;

const nonNegInt = z.number().int().min(0);
const posInt = z.number().int().min(1);

/**
 * Zod schema of the `SpriteExportManifest` document `<base>.manifest.json` (REQ-EXP-011,
 * AC-EXP-011.1). Keys follow the writer's order. Validate on the main thread or in tests only; the
 * export worker stays Zod-free (REQ-GEN-015).
 */
export const exportManifestSchema = z.object({
  format: z.literal('sprite-export-manifest'),
  version: z.literal(1),
  source: z.object({
    projectSha256: z.string().regex(/^[0-9a-f]{64}$/),
    appVersion: z.string(),
    threeVersion: z.string(),
    backend: z.enum(['webgpu', 'webgl2']),
  }),
  cell: z.object({width: posInt, height: posInt}),
  pivotPx: z.tuple([z.number(), z.number()]),
  directions: z.array(z.string()),
  scales: z.array(posInt),
  sheets: z.array(
    z.object({
      file: z.string(),
      scale: posInt,
      width: posInt,
      height: posInt,
    }),
  ),
  clips: z.array(
    z.object({
      label: z.string(),
      clipId: z.string(),
      fps: z.number().positive(),
      frameCount: nonNegInt,
      loop: z.boolean(),
      direction: z.enum(['forward', 'pingpong']),
    }),
  ),
  frames: z.array(
    z.object({
      name: z.string(),
      label: z.string(),
      direction: z.string(),
      frame: nonNegInt,
      durationMs: z.number().min(0),
      mirrored: z.boolean(),
      sheet: z.string(),
      rect: z.object({
        x: nonNegInt,
        y: nonNegInt,
        w: nonNegInt,
        h: nonNegInt,
      }),
    }),
  ),
  warnings: z.array(
    z.object({
      code: z.enum(EXPORT_WARNING_CODES),
      assets: z.array(z.string()).optional(),
      message: z.string().optional(),
    }),
  ),
});

/** A validated export manifest. */
export type ExportManifest = z.infer<typeof exportManifestSchema>;

const rectSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int(),
  h: z.number().int(),
});

/**
 * Zod schema of the array-form Aseprite sheet JSON the exporter writes (REQ-EXP-010), the shape
 * Phaser's `load.aseprite` reads. Used to validate output on the main thread or in tests, never in
 * the export worker.
 */
export const asepriteSheetSchema = z.object({
  frames: z.array(
    z.object({
      filename: z.string().min(1),
      frame: rectSchema,
      rotated: z.boolean(),
      trimmed: z.boolean(),
      spriteSourceSize: rectSchema,
      sourceSize: z.object({w: posInt, h: posInt}),
      duration: nonNegInt,
    }),
  ),
  meta: z.object({
    app: z.string(),
    version: z.string(),
    image: z.string(),
    format: z.string(),
    size: z.object({w: posInt, h: posInt}),
    scale: z.string(),
    frameTags: z.array(
      z.object({
        name: z.string().min(1),
        from: nonNegInt,
        to: nonNegInt,
        direction: z.enum(['forward', 'reverse', 'pingpong']),
      }),
    ),
    layers: z.array(z.unknown()),
    slices: z.array(z.unknown()),
  }),
});

/** A validated Aseprite sheet JSON. */
export type AsepriteSheet = z.infer<typeof asepriteSheetSchema>;
