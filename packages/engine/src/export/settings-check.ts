/**
 * Hand-written structural check of `ExportSettings` for the export worker (REQ-GEN-015: the
 * worker bundle carries no Zod). The main thread parses with the parts-schema Zod schema first
 * and sends the normalized result; this re-checks that shape because a message is untrusted
 * (REQ-GEN-016). Pure, no DOM.
 */
import type {ExportSettings, LightingMapSettings} from '@csg/parts-schema';
import type {EngineError, Result} from '../contracts';
import {exportFailure} from './errors';

/** Settings this build does not write yet (P2/P3 REQs of spec 005). */
export function unsupportedSetting(s: ExportSettings): string | null {
  if (s.extrudePx > 0) return 'extrudePx (REQ-EXP-008)';
  if (s.pngColorType !== 'rgba') return 'indexed PNGs (REQ-EXP-019)';
  if (s.previews.gif || s.previews.apng) return 'previews (REQ-EXP-014/015)';
  if (s.enginePreset !== 'none') return 'engine presets (REQ-EXP-028..031)';
  const m = s.maps;
  if (
    m !== undefined &&
    (m.normal ||
      m.albedo ||
      m.mask ||
      m.specular ||
      m.uv ||
      m.depth ||
      m.emission)
  ) {
    return 'lighting maps (spec 012)';
  }
  return null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function int(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

function oneOf<T extends string>(v: unknown, list: readonly T[]): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v);
}

const SCALES: readonly number[] = [1, 2, 4, 8];
const MAP_KINDS = [
  'normal',
  'albedo',
  'mask',
  'specular',
  'uv',
  'depth',
  'emission',
] as const;

function readMaps(v: unknown): LightingMapSettings | null {
  if (!isObject(v)) return null;
  const out: Record<string, unknown> = {};
  for (const k of MAP_KINDS) {
    if (typeof v[k] !== 'boolean') return null;
    out[k] = v[k];
  }
  if (!oneOf(v.normalConvention, ['y-up', 'y-down'] as const)) return null;
  out.normalConvention = v.normalConvention;
  const q = v.quantizeNormals;
  if (q !== undefined) {
    if (!int(q, 3, 63) || q % 2 !== 1) return null;
    out.quantizeNormals = q;
  }
  for (const k of ['uvPrecision', 'depthPrecision']) {
    const p = v[k];
    if (p !== undefined) {
      if (p !== 8 && p !== 16) return null;
      out[k] = p;
    }
  }
  const sd = v.specularDefault;
  if (sd !== undefined) {
    if (
      !isObject(sd) ||
      typeof sd.intensity !== 'number' ||
      !(sd.intensity >= 0 && sd.intensity <= 1) ||
      typeof sd.shininess !== 'number' ||
      !(sd.shininess >= 0 && sd.shininess <= 1)
    ) {
      return null;
    }
    out.specularDefault = {intensity: sd.intensity, shininess: sd.shininess};
  }
  return out as unknown as LightingMapSettings;
}

/** The first problem of a normalized settings object, else the copied value. */
function readSettings(v: unknown): ExportSettings | string {
  if (!isObject(v)) return 'settings must be an object';
  if (
    v.baseName !== undefined &&
    (typeof v.baseName !== 'string' ||
      v.baseName.length < 1 ||
      v.baseName.length > 64)
  ) {
    return 'baseName is invalid';
  }
  if (
    !oneOf(v.layout, [
      'grid-by-animation',
      'strip-per-animation',
      'frames-zip',
    ] as const)
  ) {
    return 'layout is invalid';
  }
  if (!oneOf(v.rowOrder, ['clip-major', 'direction-major'] as const)) {
    return 'rowOrder is invalid';
  }
  if (v.maxColumns !== null && !int(v.maxColumns, 1, 256)) {
    return 'maxColumns is invalid';
  }
  const scales = v.scales;
  if (
    !Array.isArray(scales) ||
    scales.length < 1 ||
    scales.length > SCALES.length ||
    !scales.every(
      (s, i) =>
        typeof s === 'number' &&
        SCALES.includes(s) &&
        (i === 0 || s > (scales[i - 1] as number)),
    )
  ) {
    return 'scales must be unique, ascending and in 1, 2, 4, 8';
  }
  if (!int(v.paddingPx, 0, 16)) return 'paddingPx is invalid';
  if (!int(v.marginPx, 0, 16)) return 'marginPx is invalid';
  if (typeof v.powerOfTwo !== 'boolean') return 'powerOfTwo is invalid';
  if (!int(v.extrudePx, 0, 2)) return 'extrudePx is invalid';
  if (v.paddingPx < 2 * v.extrudePx) {
    return 'paddingPx must be at least 2 * extrudePx';
  }
  if (!oneOf(v.metadata, ['none', 'json', 'aseprite-json'] as const)) {
    return 'metadata is invalid';
  }
  if (!oneOf(v.pngColorType, ['rgba', 'indexed'] as const)) {
    return 'pngColorType is invalid';
  }
  if (
    !oneOf(v.enginePreset, [
      'none',
      'godot4',
      'phaser3',
      'unity',
      'tiled',
    ] as const)
  ) {
    return 'enginePreset is invalid';
  }
  const pv = v.previews;
  if (
    !isObject(pv) ||
    typeof pv.gif !== 'boolean' ||
    typeof pv.apng !== 'boolean' ||
    typeof pv.scale !== 'number' ||
    !SCALES.includes(pv.scale)
  ) {
    return 'previews is invalid';
  }
  if (v.includeCredits !== true) return 'includeCredits must be true';
  let maps: LightingMapSettings | undefined;
  if (v.maps !== undefined) {
    const m = readMaps(v.maps);
    if (m === null) return 'maps is invalid';
    maps = m;
  }
  return {
    ...(v.baseName === undefined ? {} : {baseName: v.baseName}),
    layout: v.layout,
    rowOrder: v.rowOrder,
    maxColumns: v.maxColumns,
    scales: scales as ExportSettings['scales'],
    paddingPx: v.paddingPx,
    marginPx: v.marginPx,
    powerOfTwo: v.powerOfTwo,
    extrudePx: v.extrudePx,
    metadata: v.metadata,
    pngColorType: v.pngColorType,
    enginePreset: v.enginePreset,
    previews: {
      gif: pv.gif,
      apng: pv.apng,
      scale: pv.scale as ExportSettings['previews']['scale'],
    },
    ...(maps === undefined ? {} : {maps}),
    includeCredits: true,
  };
}

/**
 * Checks that `value` is a normalized `ExportSettings` (every default present) and that this
 * build can write it. It does not fill defaults: that is the main thread's Zod parse.
 *
 * @param value Untrusted settings.
 * @returns The copied settings, or `EXP_INVALID_SETTINGS`.
 */
export function checkExportSettings(
  value: unknown,
): Result<ExportSettings, EngineError> {
  const read = readSettings(value);
  if (typeof read === 'string') {
    return exportFailure(
      'EXP_INVALID_SETTINGS',
      `Invalid export settings: ${read}`,
    );
  }
  const un = unsupportedSetting(read);
  if (un !== null) {
    return exportFailure('EXP_INVALID_SETTINGS', `${un} is not supported yet`);
  }
  return {ok: true, value: read};
}
