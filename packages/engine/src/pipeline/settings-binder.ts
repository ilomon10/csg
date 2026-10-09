/**
 * Settings binder (spec 003 REQ-PIX-034, spec 007 REQ-SGF-041 and
 * "Reserved built-in param IDs", m2-plan 2.4 and 2.7).
 *
 * Owns every pipeline uniform, keyed by a stable ID: a reserved param ID
 * (`rim.strength`, `alpha.cutoff`, ...), a user param ID, or an inline key
 * `node:<nodeId>.<socketId>`. The same key always returns the same TSL
 * uniform node, so a settings change only writes `uniform.value` and never
 * recompiles a material (AC-PIX-034.1). {@link diffRenderSettings} classifies a
 * change as uniform-only or structural (post rebuild, material rebuild, resize,
 * reframe).
 *
 * Pure TSL node construction; no renderer, no GPU. The LUT `DataTexture` is the
 * only GPU-backed resource and is released by {@link SettingsBinder.dispose}.
 */
import {
  Color,
  DataTexture,
  NearestFilter,
  NoColorSpace,
  RGBAFormat,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import {float, notEqual, texture, uniform} from 'three/tsl';
import type {TextureNode, UniformNode} from 'three/webgpu';
import {PALETTE_PRESETS, hexToRgb} from '@csg/parts-schema';
import type {HexColor, RenderSettings} from '@csg/parts-schema';
import type {SocketType} from '@csg/shader-graph';
import type {TslNode} from '@csg/shader-graph/tsl';
import {
  PALETTE_LUT_BYTES,
  PALETTE_LUT_TEXTURE_SIZE,
  darkestColor,
} from './palette-lut';
import {srgb8ToLinear} from './srgb8';

/** Socket types a uniform can have (everything but `texture`). */
export type UniformSocketType = Exclude<SocketType, 'texture'>;

/**
 * Reserved param IDs of binding kind `uniform` and their socket types
 * (spec 007, "Reserved built-in param IDs"). Order follows the spec table.
 */
export const RESERVED_UNIFORM_PARAMS = {
  'toon.bands': 'int',
  'toon.thresholds': 'vec3',
  'rim.enabled': 'bool',
  'rim.strength': 'float',
  'rim.width': 'float',
  'light.azimuthDeg': 'float',
  'light.elevationDeg': 'float',
  'light.ambient': 'float',
  'outline.outer.enabled': 'bool',
  'outline.outer.widthPx': 'int',
  'outline.inner.enabled': 'bool',
  'outline.inner.depthThresholdPx': 'float',
  'outline.inner.normalThresholdDeg': 'float',
  'outline.darkenAmount': 'float',
  'outline.color': 'color',
  'dither.strength': 'float',
  'alpha.cutoff': 'float',
} as const satisfies Readonly<Record<string, UniformSocketType>>;

/** A reserved param ID of binding kind `uniform`. */
export type ReservedUniformId = keyof typeof RESERVED_UNIFORM_PARAMS;

/**
 * Reserved param IDs whose binding kind is `field` or `builtin` (spec 007).
 * They are never uniforms: {@link SettingsBinder.uniform} rejects them.
 */
export const RESERVED_NON_UNIFORM_IDS = [
  'outline.inner.sources',
  'outline.colorMode',
  'outline.inner.colorMode',
  'palette.id',
  'palette.colors',
  'palette.metric',
  'dither.mode',
] as const;

/** Value of one uniform as written by the binder. */
export type UniformValue =
  number | boolean | HexColor | readonly [number, number, number];

/** User param IDs: `[A-Za-z][A-Za-z0-9_-]{0,63}` (spec 007, rule 1). */
const USER_PARAM_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
/** Inline input uniforms: `node:<nodeId>.<socketId>` (spec 007, rule 4). */
const INLINE_KEY = /^node:[^.\s]+\.[^.\s]+$/;

/** Placeholder for threshold components at index `>= bands - 1` (ignored by spec 007). */
const UNUSED_THRESHOLD = 2;

/** Dither matrix size per `palette.dither.mode` (0 = no dither). */
export const DITHER_MATRIX_SIZE = {
  none: 0,
  bayer2: 2,
  bayer4: 4,
  bayer8: 8,
} as const satisfies Readonly<
  Record<RenderSettings['palette']['dither']['mode'], number>
>;

/**
 * Colors of the active palette in index order: `null` for `none`, the preset
 * data for `pico-8` / `endesga-32`, `palette.colors` for `custom`. Input of
 * `buildPaletteLut` and `darkestColor`.
 *
 * @param palette - `RenderSettings.palette`.
 * @returns The colors, or `null` without a palette.
 */
export function activePaletteColors(
  palette: RenderSettings['palette'],
): readonly HexColor[] | null {
  if (palette.id === 'none') return null;
  if (palette.id === 'custom') return palette.colors ?? null;
  return PALETTE_PRESETS[palette.id].colors;
}

/** Returns true if `key` is a reserved param ID of binding kind `uniform`. */
export function isReservedUniformId(key: string): key is ReservedUniformId {
  return Object.hasOwn(RESERVED_UNIFORM_PARAMS, key);
}

/**
 * Evenly spaced or explicit toon thresholds as a `vec3` (spec 007:
 * components `>= bands - 1` are ignored; they are set to 2, above any
 * `max(dot(N, L), 0)`).
 *
 * @param toon - `RenderSettings.toon`.
 * @returns `[t1, t2, t3]`.
 */
export function toonThresholds(
  toon: RenderSettings['toon'],
): [number, number, number] {
  const out: [number, number, number] = [
    UNUSED_THRESHOLD,
    UNUSED_THRESHOLD,
    UNUSED_THRESHOLD,
  ];
  for (let i = 0; i < toon.bands - 1; i++) {
    out[i] = toon.thresholds?.[i] ?? (i + 1) / toon.bands;
  }
  return out;
}

/**
 * View-space light direction `L = (cos e · cos a, cos e · sin a, sin e)`
 * (REQ-PIX-013, AC-PIX-013.3). Same for every preset and direction.
 *
 * @param lighting - `RenderSettings.lighting`.
 * @returns Unit vector, x screen-right, y screen-up, z toward the viewer.
 */
export function lightDirection(
  lighting: RenderSettings['lighting'],
): [number, number, number] {
  const a = (lighting.azimuthDeg * Math.PI) / 180;
  const e = (lighting.elevationDeg * Math.PI) / 180;
  const ce = Math.cos(e);
  return [ce * Math.cos(a), ce * Math.sin(a), Math.sin(e)];
}

/**
 * Values of every reserved `uniform` param for the given settings
 * (spec 007 table). `outline.color` falls back to `#000000` when unset.
 *
 * @param s - Validated settings.
 * @returns One value per {@link ReservedUniformId}.
 */
export function reservedUniformValues(
  s: RenderSettings,
): Record<ReservedUniformId, UniformValue> {
  return {
    'toon.bands': s.toon.bands,
    'toon.thresholds': toonThresholds(s.toon),
    'rim.enabled': s.toon.rim.enabled,
    'rim.strength': s.toon.rim.strength,
    // Deprecated (FX-J): kept as a uniform for legacy `toon.rim@1` graphs.
    'rim.width': s.toon.rim.width ?? 0.25,
    'light.azimuthDeg': s.lighting.azimuthDeg,
    'light.elevationDeg': s.lighting.elevationDeg,
    'light.ambient': s.lighting.ambient,
    'outline.outer.enabled': s.outline.outer.enabled,
    'outline.outer.widthPx': s.outline.outer.widthPx,
    'outline.inner.enabled': s.outline.inner.enabled,
    'outline.inner.depthThresholdPx': s.outline.inner.depthThresholdPx,
    'outline.inner.normalThresholdDeg': s.outline.inner.normalThresholdDeg,
    'outline.darkenAmount': s.outline.darkenAmount,
    'outline.color': s.outline.color ?? '#000000',
    'dither.strength': s.palette.dither.strength,
    'alpha.cutoff': s.alphaCutoff,
  };
}

/** How a settings change must be applied (m2-plan 2.7). */
export interface RenderSettingsDiff {
  /** Dotted leaf paths that differ, sorted (array items as `path.<index>`). */
  readonly changed: readonly string[];
  /** Some uniform value changed (written in place, no recompile). */
  readonly uniforms: boolean;
  /** The effective palette (id, colors, metric) changed: rebuild + re-upload the LUT, no recompile. */
  readonly palette: boolean;
  /** The post pipeline must be recompiled (dither mode, inner sources, color mode, palette none↔on, post graph). */
  readonly post: boolean;
  /** Node materials must be recompiled (material graph). */
  readonly material: boolean;
  /** Render targets and the drawing buffer change size (resolution). */
  readonly resize: boolean;
  /** Framing must be recomputed (camera, directions, animations, outer outline width margin). */
  readonly reframe: boolean;
}

type ChangeClass =
  'uniforms' | 'palette' | 'post' | 'material' | 'resize' | 'reframe';

/**
 * Leaf path prefix → change classes. The longest matching prefix wins; a path
 * without a rule is treated as a full rebuild (`post` and `material`).
 */
const CHANGE_RULES: ReadonlyArray<readonly [string, readonly ChangeClass[]]> = [
  ['resolution', ['resize', 'reframe']],
  ['camera', ['reframe']],
  ['directions', ['reframe']],
  ['singleFacing', ['reframe']],
  ['mirrorWest', ['reframe']],
  ['animations', ['reframe']],
  ['lighting', ['uniforms']],
  ['toon', ['uniforms']],
  ['outline.outer.enabled', ['uniforms']],
  // Auto framing reserves `outerWidth + 1` px of margin (m2-plan 2.5).
  ['outline.outer.widthPx', ['uniforms', 'reframe']],
  ['outline.inner.enabled', ['uniforms']],
  ['outline.inner.partId', ['post']],
  ['outline.inner.depth', ['post']],
  ['outline.inner.normal', ['post']],
  ['outline.inner.depthThresholdPx', ['uniforms']],
  ['outline.inner.normalThresholdDeg', ['uniforms']],
  ['outline.colorMode', ['post']],
  ['outline.inner.colorMode', ['post']],
  ['outline.darkenAmount', ['uniforms']],
  ['outline.color', ['uniforms']],
  ['materialGraph', ['material']],
  ['postGraph', ['post']],
  ['params', ['uniforms']],
  ['palette.id', ['palette']],
  ['palette.colors', ['palette']],
  ['palette.metric', ['palette']],
  ['palette.dither.mode', ['post']],
  ['palette.dither.strength', ['uniforms']],
  ['alphaCutoff', ['uniforms']],
];

function rulesFor(path: string): readonly ChangeClass[] | undefined {
  let best: readonly [string, readonly ChangeClass[]] | undefined;
  for (const rule of CHANGE_RULES) {
    const [prefix] = rule;
    if (
      (path === prefix || path.startsWith(`${prefix}.`)) &&
      (best === undefined || prefix.length > best[0].length)
    ) {
      best = rule;
    }
  }
  return best?.[1];
}

/** Collects differing leaf paths; keys are visited sorted (deterministic). */
function collectChanges(
  a: unknown,
  b: unknown,
  path: string,
  out: string[],
): void {
  if (Object.is(a, b)) return;
  const aObj = typeof a === 'object' && a !== null;
  const bObj = typeof b === 'object' && b !== null;
  if (!aObj || !bObj || Array.isArray(a) !== Array.isArray(b)) {
    out.push(path);
    return;
  }
  const keys = new Set([
    ...Object.keys(a as object),
    ...Object.keys(b as object),
  ]);
  for (const key of [...keys].sort()) {
    collectChanges(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
      path === '' ? key : `${path}.${key}`,
      out,
    );
  }
}

/**
 * Classifies the change from `prev` to `next` (REQ-PIX-034, m2-plan 2.7).
 * Uniform-only changes (rim, light, bands, thresholds, outline widths and
 * thresholds, dither strength, alpha cutoff, palette colors) never recompile.
 * Palette `none` ↔ a palette rebuilds the post pipeline (dither is skipped
 * without a palette, AC-PIX-022.3).
 *
 * @param prev - Settings currently applied, or `undefined` for the first apply.
 * @param next - New validated settings.
 * @returns The change classes; all flags are set when `prev` is undefined.
 */
export function diffRenderSettings(
  prev: RenderSettings | undefined,
  next: RenderSettings,
): RenderSettingsDiff {
  if (prev === undefined) {
    return {
      changed: [],
      uniforms: true,
      palette: true,
      post: true,
      material: true,
      resize: true,
      reframe: true,
    };
  }
  const changed: string[] = [];
  collectChanges(prev, next, '', changed);
  const flags: Record<ChangeClass, boolean> = {
    uniforms: false,
    palette: false,
    post: false,
    material: false,
    resize: false,
    reframe: false,
  };
  for (const path of changed) {
    const classes = rulesFor(path) ?? (['post', 'material'] as const);
    for (const c of classes) flags[c] = true;
  }
  if ((prev.palette.id === 'none') !== (next.palette.id === 'none')) {
    flags.post = true;
  }
  return {changed, ...flags};
}

/** True if the diff needs no recompile, resize or reframe (AC-PIX-034.1). */
export function isUniformOnly(diff: RenderSettingsDiff): boolean {
  return !diff.post && !diff.material && !diff.resize && !diff.reframe;
}

type AnyUniform = UniformNode<string, unknown>;

/** One registered uniform. */
interface UniformEntry {
  readonly type: UniformSocketType;
  /** The `UniformNode` whose `value` is written. */
  readonly node: AnyUniform;
  /** What `uniform()` returns: `node`, or a bool expression for `bool`. */
  readonly exposed: TslNode;
}

function invalid(key: string, type: string, value: unknown): TypeError {
  return new TypeError(
    `uniform "${key}" (${type}): invalid value ${JSON.stringify(value)}`,
  );
}

function isNumberTuple(value: unknown, n: number): value is readonly number[] {
  return (
    Array.isArray(value) &&
    value.length === n &&
    value.every(v => typeof v === 'number' && Number.isFinite(v))
  );
}

/**
 * Writes an sRGB `#rrggbb` into `color` as linear values, through the
 * committed 8-bit table (bit-identical across JS engines, REQ-PIX-027).
 */
function setHexLinear(color: Color, hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (rgb === null) return false;
  color.r = srgb8ToLinear(rgb[0]);
  color.g = srgb8ToLinear(rgb[1]);
  color.b = srgb8ToLinear(rgb[2]);
  return true;
}

/** Writes `value` into an entry; returns false when the value does not fit the type. */
function writeValue(entry: UniformEntry, value: unknown): boolean {
  const node = entry.node;
  switch (entry.type) {
    case 'float':
    case 'int':
      if (typeof value !== 'number' || !Number.isFinite(value)) return false;
      node.value = entry.type === 'int' ? Math.trunc(value) : value;
      return true;
    case 'bool':
      if (typeof value !== 'boolean') return false;
      node.value = value ? 1 : 0;
      return true;
    case 'vec2':
      if (!isNumberTuple(value, 2)) return false;
      (node.value as Vector2).set(value[0] ?? 0, value[1] ?? 0);
      return true;
    case 'vec3':
      if (!isNumberTuple(value, 3)) return false;
      (node.value as Vector3).set(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0);
      return true;
    case 'vec4':
      if (!isNumberTuple(value, 4)) return false;
      (node.value as Vector4).set(
        value[0] ?? 0,
        value[1] ?? 0,
        value[2] ?? 0,
        value[3] ?? 0,
      );
      return true;
    case 'color':
      if (typeof value === 'string') {
        return setHexLinear(node.value as Color, value);
      }
      if (!isNumberTuple(value, 3)) return false;
      // A tuple is already linear.
      (node.value as Color).setRGB(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0);
      return true;
  }
}

function createEntry(type: UniformSocketType): UniformEntry {
  switch (type) {
    case 'float': {
      const node = uniform(0) as AnyUniform;
      return {type, node, exposed: node};
    }
    case 'int': {
      const node = uniform(0, 'int') as AnyUniform;
      return {type, node, exposed: node};
    }
    case 'bool': {
      // WGSL cannot hold `bool` in a uniform buffer and three r186 has no bool
      // NodeUniform: store 0/1 as float and expose `value != 0`.
      const node = uniform(0);
      return {
        type,
        node: node as AnyUniform,
        exposed: notEqual(node, float(0)),
      };
    }
    case 'vec2': {
      const node = uniform(new Vector2()) as AnyUniform;
      return {type, node, exposed: node};
    }
    case 'vec3': {
      const node = uniform(new Vector3()) as AnyUniform;
      return {type, node, exposed: node};
    }
    case 'vec4': {
      const node = uniform(new Vector4()) as AnyUniform;
      return {type, node, exposed: node};
    }
    case 'color': {
      const node = uniform(new Color(0, 0, 0)) as AnyUniform;
      return {type, node, exposed: node};
    }
  }
}

function userParamType(value: UniformValue): UniformSocketType {
  if (typeof value === 'number') return 'float';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'string') return 'color';
  return 'vec3';
}

/**
 * Owns the pipeline uniforms and binds `RenderSettings` to them
 * (REQ-PIX-034, REQ-SGF-041). One binder per renderer; material and post
 * {@link import('./stage-context').createStageContext | stage contexts} share
 * it, so both read the same uniform node for the same key.
 */
export class SettingsBinder {
  private readonly entries = new Map<string, UniformEntry>();
  private current: RenderSettings | undefined;
  private lut: DataTexture | undefined;
  private lutNode: TextureNode | undefined;
  private paletteLoaded = false;

  /** `light.dir` builtin: view-space light vector, derived on the CPU. */
  readonly lightDir = uniform(new Vector3(0, 0, 1));
  /** `resolution` builtin: cell size in px (`W`, `H`). */
  readonly resolution = uniform(new Vector2(64, 64));
  /**
   * Linear RGB of `render.paletteDarkest`: the palette entry with the lowest
   * OKLab lightness, black for palette `none` (REQ-PIX-017, AC-SGF-043.1).
   */
  readonly paletteDarkest = uniform(new Color(0, 0, 0));
  /** Backing value of `render.paletteEnabled`: 1 unless the palette is `none`. */
  readonly paletteEnabledValue = uniform(0);
  /** `render.paletteEnabled` builtin (bool). */
  readonly paletteEnabled: TslNode = notEqual(
    this.paletteEnabledValue,
    float(0),
  );
  /** `time` builtin in seconds; set by the host from the sampled frame time, never the clock. */
  readonly time = uniform(0);

  /**
   * @param settings - Optional settings applied right away.
   */
  constructor(settings?: RenderSettings) {
    if (settings !== undefined) this.apply(settings);
  }

  /** The settings last passed to {@link apply}. */
  get settings(): RenderSettings | undefined {
    return this.current;
  }

  /** Dither matrix size of the applied settings (0 = none or palette `none`). */
  get ditherMatrixSize(): 0 | 2 | 4 | 8 {
    const s = this.current;
    if (s === undefined || s.palette.id === 'none') return 0;
    return DITHER_MATRIX_SIZE[s.palette.dither.mode];
  }

  /**
   * False after a change of the effective palette until {@link setPaletteLut}
   * uploads the matching LUT. The host must not render (preview or export)
   * with `paletteReady === false` (REQ-PIX-027).
   */
  get paletteReady(): boolean {
    return this.current?.palette.id === 'none' || this.paletteLoaded;
  }

  /** Registered uniform keys, sorted. */
  keys(): string[] {
    return [...this.entries.keys()].sort();
  }

  /** The `UniformNode` behind `key` (for spies and M4's `CompileResult.uniforms`). */
  uniformNode(key: string): AnyUniform | undefined {
    return this.entries.get(key)?.node;
  }

  /**
   * Creates or reuses the uniform keyed by `key` (spec 007 `CompileContext.uniform`).
   * Reserved IDs must use the table type and take their value from the applied
   * settings (`initial` is ignored); user params take `RenderSettings.params[key]`
   * when present; inline keys `node:<id>.<socket>` keep `initial`.
   *
   * @param key - Reserved ID, user param ID or `node:<nodeId>.<socketId>`.
   * @param type - Socket type.
   * @param initial - Initial value (number, boolean, `#rrggbb`, or a number tuple).
   * @returns The same node for the same key.
   * @throws TypeError on an invalid key, a type mismatch or an invalid initial value.
   */
  uniform(key: string, type: UniformSocketType, initial: unknown): TslNode {
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      if (existing.type !== type) {
        throw new TypeError(
          `uniform "${key}" is ${existing.type}, requested as ${type}`,
        );
      }
      return existing.exposed;
    }
    const reserved = isReservedUniformId(key);
    if (reserved) {
      const expected = RESERVED_UNIFORM_PARAMS[key];
      if (expected !== type) {
        throw new TypeError(
          `reserved param "${key}" must be ${expected}, got ${type}`,
        );
      }
    } else if ((RESERVED_NON_UNIFORM_IDS as readonly string[]).includes(key)) {
      throw new TypeError(`reserved param "${key}" is not a uniform`);
    } else if (!USER_PARAM_ID.test(key) && !INLINE_KEY.test(key)) {
      throw new TypeError(`invalid uniform key "${key}"`);
    }

    const entry = createEntry(type);
    let value: unknown = initial;
    if (reserved && this.current !== undefined) {
      value = reservedUniformValues(this.current)[key];
    } else if (!reserved && this.current?.params[key] !== undefined) {
      const param = this.current.params[key];
      if (param !== undefined && userParamType(param) === type) value = param;
    }
    // A reserved uniform requested before the first apply() without an
    // initial value starts at zero; apply() writes the real value.
    const deferred =
      reserved && this.current === undefined && value === undefined;
    if (!deferred && !writeValue(entry, value)) {
      throw invalid(key, type, value);
    }
    this.entries.set(key, entry);
    return entry.exposed;
  }

  /**
   * Writes the settings into the uniforms in place and returns what changed.
   * Never recompiles: the caller rebuilds post/materials only when the diff
   * says so (REQ-PIX-034). Allocates nothing for uniform-only changes beyond
   * the diff itself.
   *
   * @param settings - Validated settings (`parseRenderSettings`).
   * @returns {@link diffRenderSettings} against the previously applied settings.
   */
  apply(settings: RenderSettings): RenderSettingsDiff {
    const diff = diffRenderSettings(this.current, settings);
    this.current = settings;

    const reserved = reservedUniformValues(settings);
    for (const key of Object.keys(reserved) as ReservedUniformId[]) {
      const entry = this.entries.get(key);
      if (entry !== undefined && !writeValue(entry, reserved[key])) {
        throw invalid(key, entry.type, reserved[key]);
      }
    }
    for (const key of Object.keys(settings.params).sort()) {
      const entry = this.entries.get(key);
      const value = settings.params[key];
      // A type mismatch is reported by graph validation (M4); keep the old value.
      if (entry !== undefined && value !== undefined) writeValue(entry, value);
    }

    const [lx, ly, lz] = lightDirection(settings.lighting);
    this.lightDir.value.set(lx, ly, lz);
    this.resolution.value.set(
      settings.resolution.width,
      settings.resolution.height,
    );
    if (diff.palette) {
      const colors = activePaletteColors(settings.palette);
      setHexLinear(
        this.paletteDarkest.value,
        colors === null ? '#000000' : darkestColor(colors),
      );
      this.paletteLoaded = colors === null;
    }
    this.paletteEnabledValue.value = settings.palette.id === 'none' ? 0 : 1;
    return diff;
  }

  /**
   * Uploads the LUT built for the applied palette (`buildPaletteLut` over
   * {@link activePaletteColors}, REQ-PIX-021) into the reused texture. No
   * recompile.
   *
   * @param lut - `512 · 512 · 4` bytes.
   * @throws TypeError on a wrong LUT size.
   */
  setPaletteLut(lut: Uint8Array): void {
    if (lut.length !== PALETTE_LUT_BYTES) {
      throw new TypeError(
        `palette LUT must be ${PALETTE_LUT_BYTES} bytes, got ${lut.length}`,
      );
    }
    const tex = this.lutTexture();
    (tex.image.data as Uint8Array).set(lut);
    tex.needsUpdate = true;
    this.paletteLoaded = true;
  }

  /** `render.paletteLut` builtin: one texture node over the reused LUT texture. */
  paletteLutNode(): TextureNode {
    this.lutNode ??= texture(this.lutTexture());
    return this.lutNode;
  }

  /** Releases the LUT texture. Uniform nodes hold no GPU resources. */
  dispose(): void {
    this.lut?.dispose();
  }

  private lutTexture(): DataTexture {
    if (this.lut === undefined) {
      const tex = new DataTexture(
        new Uint8Array(PALETTE_LUT_BYTES),
        PALETTE_LUT_TEXTURE_SIZE,
        PALETTE_LUT_TEXTURE_SIZE,
        RGBAFormat,
        UnsignedByteType,
      );
      tex.colorSpace = NoColorSpace;
      tex.magFilter = NearestFilter;
      tex.minFilter = NearestFilter;
      tex.generateMipmaps = false;
      tex.flipY = false;
      tex.needsUpdate = true;
      this.lut = tex;
    }
    return this.lut;
  }
}
