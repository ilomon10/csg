import {z} from 'zod';
import {animationSelectionsSchema} from './animation-selection';
import {dedupeColors, MAX_PALETTE_COLORS} from './palettes';
import {formatPath, hexColorSchema} from './primitives';
import type {HexColor, SchemaIssue} from './primitives';

/** Direction labels in canonical order: counter-clockwise from screen-right (spec 003). */
export const DIRECTION_ORDER = [
  'e',
  'ne',
  'n',
  'nw',
  'w',
  'sw',
  's',
  'se',
] as const;

/** One of the eight direction labels. */
export type DirectionLabel = (typeof DIRECTION_ORDER)[number];

/** Camera presets (REQ-PIX-004). */
export const CAMERA_PRESETS = [
  'side',
  'three-quarter',
  'isometric',
  'custom',
] as const;

/** A camera preset ID. */
export type CameraPreset = (typeof CAMERA_PRESETS)[number];

/** Palette IDs of `RenderSettings.palette.id`. */
export const PALETTE_IDS = ['none', 'pico-8', 'endesga-32', 'custom'] as const;

/** Preset-dependent defaults (spec 003 Data & contracts, Defaults table). */
const PRESET_DEFAULTS = {
  side: {elevationDeg: 0, directions: 2, singleFacing: 'e', pivotRowPx: 2},
  'three-quarter': {
    elevationDeg: 35,
    directions: 8,
    singleFacing: 's',
    pivotRowPx: 4,
  },
  isometric: {
    elevationDeg: 30,
    directions: 8,
    singleFacing: 's',
    pivotRowPx: 6,
  },
  // Not specified for `custom`; it starts from the three-quarter values.
  custom: {
    elevationDeg: 35,
    directions: 8,
    singleFacing: 's',
    pivotRowPx: 4,
  },
} as const;

const FIELD_ERROR = 'PIX_INVALID_SETTINGS';

const dimension = z.number().int().min(32).max(128);
const unit = z.number().min(0).max(1);

const settingsInputSchema = z.object({
  resolution: z
    .object({width: dimension, height: dimension})
    .prefault({width: 64, height: 64}),
  camera: z
    .object({
      preset: z.enum(CAMERA_PRESETS).default('side'),
      elevationDeg: z.number().finite().optional(),
      framing: z
        .union([z.literal('auto'), z.number().positive()])
        .default('auto'),
      pivotRowPx: z.number().int().min(0).optional(),
    })
    .prefault({}),
  directions: z
    .union([z.literal(1), z.literal(2), z.literal(4), z.literal(8)])
    .optional(),
  singleFacing: z.enum(DIRECTION_ORDER).optional(),
  mirrorWest: z.boolean().default(false),
  animations: animationSelectionsSchema.default([]),
  lighting: z
    .object({
      azimuthDeg: z.number().min(0).max(360).default(135),
      elevationDeg: z.number().min(0).max(90).default(45),
      ambient: unit.default(0.15),
    })
    .prefault({}),
  toon: z
    .object({
      bands: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
      thresholds: z.array(z.number().gt(0).lt(1)).optional(),
      rim: z
        .object({
          enabled: z.boolean().default(true),
          strength: unit.default(0.35),
          width: unit.default(0.25),
        })
        .prefault({}),
    })
    .prefault({}),
  outline: z
    .object({
      outer: z
        .object({
          enabled: z.boolean().default(true),
          widthPx: z
            .union([z.literal(1), z.literal(2), z.literal(3)])
            .default(1),
        })
        .prefault({}),
      inner: z
        .object({
          enabled: z.boolean().default(true),
          partId: z.boolean().default(true),
          depth: z.boolean().default(false),
          normal: z.boolean().default(false),
          depthThresholdPx: z.number().positive().default(4),
          normalThresholdDeg: z.number().min(1).max(179).default(60),
        })
        .prefault({}),
      colorMode: z.enum(['black', 'darken', 'custom']).default('darken'),
      darkenAmount: unit.default(0.6),
      color: hexColorSchema.optional(),
    })
    .prefault({}),
  materialGraph: z.string().min(1).default('builtin:material-toon'),
  postGraph: z.string().min(1).default('builtin:post-default'),
  params: z
    .record(
      z.string(),
      z.union([
        z.number(),
        z.boolean(),
        hexColorSchema,
        z.tuple([z.number(), z.number(), z.number()]),
      ]),
    )
    .default({}),
  palette: z
    .object({
      id: z.enum(PALETTE_IDS).default('none'),
      colors: z.array(hexColorSchema).optional(),
      metric: z.enum(['oklab', 'srgb']).default('oklab'),
      dither: z
        .object({
          mode: z.enum(['none', 'bayer2', 'bayer4', 'bayer8']).default('none'),
          strength: unit.default(0.5),
        })
        .prefault({}),
    })
    .prefault({}),
  alphaCutoff: z.number().min(0.01).max(1).default(0.5),
});

type SettingsInput = z.infer<typeof settingsInputSchema>;

/** Validated render settings with every default filled in (spec 003 Data & contracts). */
export interface RenderSettings {
  /** Integers 32..128. */
  resolution: {width: number; height: number};
  camera: {
    preset: CameraPreset;
    /** Ignored unless `preset` is `custom`; 0..90 in 0.5 steps. Presets: 0 / 35 / 30. */
    elevationDeg: number;
    /** `auto` fits the union bounds; a number is world units per pixel (> 0). */
    framing: 'auto' | number;
    /** Ground pivot row from the bottom, 0..height-1. */
    pivotRowPx: number;
  };
  directions: 1 | 2 | 4 | 8;
  /** Facing used when `directions` is 1. */
  singleFacing: DirectionLabel;
  /** Mirror e/ne/se into w/nw/sw instead of rendering them. */
  mirrorWest: boolean;
  animations: z.infer<typeof animationSelectionsSchema>;
  lighting: {azimuthDeg: number; elevationDeg: number; ambient: number};
  toon: {
    bands: 2 | 3 | 4;
    /** `bands - 1` strictly ascending values in (0, 1); omitted means evenly spaced. */
    thresholds?: number[];
    rim: {enabled: boolean; strength: number; width: number};
  };
  outline: {
    outer: {enabled: boolean; widthPx: 1 | 2 | 3};
    inner: {
      enabled: boolean;
      partId: boolean;
      depth: boolean;
      normal: boolean;
      depthThresholdPx: number;
      normalThresholdDeg: number;
    };
    colorMode: 'black' | 'darken' | 'custom';
    darkenAmount: number;
    /** Required when `colorMode` is `custom`. */
    color?: HexColor;
  };
  materialGraph: string;
  postGraph: string;
  /** User-declared graph params only; reserved IDs live in the typed fields (spec 007). */
  params: Record<
    string,
    number | boolean | HexColor | [number, number, number]
  >;
  palette: {
    id: (typeof PALETTE_IDS)[number];
    /** Required when `id` is `custom`: 1..256 unique colors. */
    colors?: HexColor[];
    metric: 'oklab' | 'srgb';
    dither: {mode: 'none' | 'bayer2' | 'bayer4' | 'bayer8'; strength: number};
  };
  alphaCutoff: number;
}

/** Error codes of render-settings validation (spec 003). `PIX_INVALID_SETTINGS` covers other fields. */
export type RenderSettingsErrorCode =
  | 'PIX_INVALID_RESOLUTION'
  | 'PIX_INVALID_CAMERA'
  | 'PIX_INVALID_DIRECTIONS'
  | 'PIX_INVALID_TOON'
  | 'PIX_PALETTE_TOO_LARGE'
  | 'PIX_PALETTE_PARSE'
  | typeof FIELD_ERROR;

/** A validation error with a stable code. */
export interface RenderSettingsIssue extends SchemaIssue {
  code: RenderSettingsErrorCode;
}

/** A non-fatal finding of render-settings validation. */
export interface RenderSettingsWarning {
  code: 'PIX_PALETTE_DUPLICATES';
  path: string;
  message: string;
  /** The colors that were dropped. */
  removed: string[];
}

/** Result of {@link parseRenderSettings}; every invalid field is reported at once (REQ-PIX-037). */
export type RenderSettingsResult =
  | {ok: true; value: RenderSettings; warnings: RenderSettingsWarning[]}
  | {ok: false; issues: RenderSettingsIssue[]};

/** Returns the full default settings for a camera preset (spec 003 Defaults table). */
export function defaultRenderSettings(
  preset: CameraPreset = 'side',
): RenderSettings {
  const result = parseRenderSettings({camera: {preset}});
  if (!result.ok) throw new Error('default render settings are invalid');
  return result.value;
}

function codeFor(path: string): RenderSettingsErrorCode {
  if (path === 'resolution' || path.startsWith('resolution.'))
    return 'PIX_INVALID_RESOLUTION';
  if (path.startsWith('camera')) return 'PIX_INVALID_CAMERA';
  if (path === 'directions' || path === 'singleFacing')
    return 'PIX_INVALID_DIRECTIONS';
  if (path.startsWith('toon')) return 'PIX_INVALID_TOON';
  if (path.startsWith('palette.colors')) return 'PIX_PALETTE_PARSE';
  if (path.startsWith('palette.id')) return 'PIX_PALETTE_PARSE';
  return FIELD_ERROR;
}

function fail(path: string, message: string): RenderSettingsIssue {
  return {
    path,
    message,
    code: codeFor(path),
  };
}

function crossChecks(value: SettingsInput): RenderSettingsIssue[] {
  const issues: RenderSettingsIssue[] = [];
  const {camera, toon, outline, palette, resolution} = value;
  const elevation = camera.elevationDeg;
  if (
    camera.preset === 'custom' &&
    elevation !== undefined &&
    (elevation < 0 || elevation > 90 || (elevation * 2) % 1 !== 0)
  ) {
    issues.push(
      fail(
        'camera.elevationDeg',
        'custom elevation must be 0..90 in 0.5 steps',
      ),
    );
  }
  if (
    camera.pivotRowPx !== undefined &&
    camera.pivotRowPx > resolution.height - 1
  ) {
    issues.push(
      fail(
        'camera.pivotRowPx',
        `pivot row must be 0..${resolution.height - 1}`,
      ),
    );
  }
  if (toon.thresholds !== undefined) {
    const t = toon.thresholds;
    if (t.length !== toon.bands - 1) {
      issues.push(
        fail('toon.thresholds', `expected ${toon.bands - 1} thresholds`),
      );
    } else if (t.some((v, i) => i > 0 && v <= (t[i - 1] ?? 0))) {
      issues.push(
        fail('toon.thresholds', 'thresholds must be strictly ascending'),
      );
    }
  }
  if (outline.colorMode === 'custom' && outline.color === undefined) {
    issues.push(fail('outline.color', 'required when colorMode is custom'));
  }
  if (palette.id === 'custom') {
    if (palette.colors === undefined || palette.colors.length === 0) {
      issues.push(
        fail('palette.colors', 'a custom palette needs 1..256 colors'),
      );
    }
  }
  return issues;
}

/**
 * Validates `RenderSettings`, fills missing optional fields with the per-preset defaults of
 * spec 003, and reports every invalid field in one result (REQ-PIX-037). Custom palette
 * duplicates are dropped (first occurrence wins) with a `PIX_PALETTE_DUPLICATES` warning
 * (REQ-PIX-019). A palette is checked against the 256 limit after duplicates are dropped.
 */
export function parseRenderSettings(input: unknown): RenderSettingsResult {
  const warnings: RenderSettingsWarning[] = [];
  let raw = input;
  const palette = (input as {palette?: {id?: unknown; colors?: unknown}} | null)
    ?.palette;
  if (
    typeof palette === 'object' &&
    palette !== null &&
    palette.id === 'custom' &&
    Array.isArray(palette.colors)
  ) {
    const {kept, removed} = dedupeColors(palette.colors as unknown[]);
    if (removed.length > 0) {
      warnings.push({
        code: 'PIX_PALETTE_DUPLICATES',
        path: 'palette.colors',
        message: `${removed.length} duplicate color${removed.length === 1 ? '' : 's'} removed`,
        removed: removed.map(String),
      });
      raw = {...(input as object), palette: {...palette, colors: kept}};
    }
  }

  const parsed = settingsInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map(issue => {
        const path = formatPath(issue.path);
        return {
          path,
          message: issue.message,
          code: codeFor(path),
          field: String(issue.path[issue.path.length - 1] ?? ''),
        };
      }),
    };
  }
  const v = parsed.data;
  const issues = crossChecks(v);
  if (
    v.palette.colors !== undefined &&
    v.palette.colors.length > MAX_PALETTE_COLORS
  ) {
    issues.push({
      path: 'palette.colors',
      message: `a palette holds at most ${MAX_PALETTE_COLORS} colors`,
      code: 'PIX_PALETTE_TOO_LARGE',
    });
  }
  if (issues.length > 0) {
    return {ok: false, issues};
  }

  const d = PRESET_DEFAULTS[v.camera.preset];
  const value: RenderSettings = {
    resolution: v.resolution,
    camera: {
      preset: v.camera.preset,
      elevationDeg: v.camera.elevationDeg ?? d.elevationDeg,
      framing: v.camera.framing,
      pivotRowPx: v.camera.pivotRowPx ?? d.pivotRowPx,
    },
    directions: v.directions ?? d.directions,
    singleFacing: v.singleFacing ?? d.singleFacing,
    mirrorWest: v.mirrorWest,
    animations: v.animations,
    lighting: v.lighting,
    toon: v.toon,
    outline: v.outline,
    materialGraph: v.materialGraph,
    postGraph: v.postGraph,
    params: v.params,
    palette: v.palette,
    alphaCutoff: v.alphaCutoff,
  };
  return {ok: true, value, warnings};
}
