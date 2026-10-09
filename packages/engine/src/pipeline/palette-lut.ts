/**
 * Palette lookup table (REQ-PIX-021, amendment A7) and the darkest-color helper (REQ-PIX-017).
 *
 * The LUT maps every 6-bit-per-channel sRGB level to its nearest palette entry, measured by
 * Euclidean distance in OKLab (default) or 8-bit sRGB, ties broken by the lowest palette index.
 * It is a 512×512 RGBA8 texture of 64 tiles of 64×64. The builder uses only `+ - * /` and
 * comparisons on doubles plus committed tables, so Node and every browser engine build the
 * same bytes. The GPU only looks the table up (`post.paletteQuantize@1`).
 *
 * @module
 */

import type {HexColor} from '@csg/parts-schema';
import {linearSrgbToOklab} from './oklab';
import type {Oklab} from './oklab';
import {SRGB8_TO_LINEAR} from './srgb8';

/** LUT levels per channel; the LUT has `64³` entries (REQ-PIX-021). */
export const PALETTE_LUT_SIZE = 64;

/** Width and height in texels of the LUT texture: 8 × 8 tiles of 64 × 64. */
export const PALETTE_LUT_TEXTURE_SIZE = 512;

/** Byte length of a LUT built by {@link buildPaletteLut}: `512 · 512 · 4`. */
export const PALETTE_LUT_BYTES =
  PALETTE_LUT_TEXTURE_SIZE * PALETTE_LUT_TEXTURE_SIZE * 4;

/** Most palette entries a LUT can index; the alpha byte stores the index (REQ-PIX-019). */
export const PALETTE_LUT_MAX_COLORS = 256;

/** Nearest-color metric of the palette mapping (`RenderSettings.palette.metric`). */
export type PaletteMetric = 'oklab' | 'srgb';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Local `#rrggbb` parser, equal to `hexToRgb` of `@csg/parts-schema`. Kept here so the palette
 * LUT worker bundle does not pull in the parts-schema barrel and zod (FX-R2).
 */
function hexToRgb(hex: string): [number, number, number] | null {
  if (!HEX_COLOR.test(hex)) return null;
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function assertByte(name: string, v: number): void {
  if (!Number.isInteger(v) || v < 0 || v > 255) {
    throw new RangeError(`${name}: expected an integer 0..255, got ${v}`);
  }
}

/**
 * LUT level of an 8-bit sRGB channel value: `floor((c8 · 63 + 127) / 255)`, 0..63. The GPU
 * applies the same integer formula after `c8 = clamp(floor(c · 255 + 0.5), 0, 255)`.
 * Throws `RangeError` unless `c8` is an integer 0..255.
 */
export function lutIndex(c8: number): number {
  assertByte('lutIndex', c8);
  return Math.floor((c8 * 63 + 127) / 255);
}

/**
 * 8-bit sRGB value a LUT level stands for: `floor((i · 255 + 31) / 63)`, so
 * `lutIndex(lutLevel(i)) = i`. Throws `RangeError` unless `i` is an integer 0..63.
 */
export function lutLevel(i: number): number {
  if (!Number.isInteger(i) || i < 0 || i >= PALETTE_LUT_SIZE) {
    throw new RangeError(`lutLevel: expected an integer 0..63, got ${i}`);
  }
  return Math.floor((i * 255 + 31) / 63);
}

/**
 * Byte offset of LUT entry `(r, g, b)` (levels 0..63): texel
 * `(x, y) = ((b mod 8) · 64 + r, floor(b / 8) · 64 + g)`, offset `(y · 512 + x) · 4`.
 */
export function lutTexelOffset(r: number, g: number, b: number): number {
  const x = (b % 8) * PALETTE_LUT_SIZE + r;
  const y = Math.floor(b / 8) * PALETTE_LUT_SIZE + g;
  return (y * PALETTE_LUT_TEXTURE_SIZE + x) * 4;
}

function parsePalette(
  colors: readonly HexColor[],
  fn: string,
): [number, number, number][] {
  if (colors.length < 1 || colors.length > PALETTE_LUT_MAX_COLORS) {
    throw new RangeError(
      `${fn}: palette must have 1..${PALETTE_LUT_MAX_COLORS} colors, got ${colors.length}`,
    );
  }
  return colors.map((hex, i) => {
    const rgb = hexToRgb(hex);
    if (rgb === null) {
      throw new RangeError(
        `${fn}: colors[${i}] is not #rrggbb: ${String(hex)}`,
      );
    }
    return rgb;
  });
}

function oklabOf8(rgb: readonly [number, number, number], out: Oklab): Oklab {
  return linearSrgbToOklab(
    SRGB8_TO_LINEAR[rgb[0]] as number,
    SRGB8_TO_LINEAR[rgb[1]] as number,
    SRGB8_TO_LINEAR[rgb[2]] as number,
    out,
  );
}

/**
 * Index of the palette entry nearest to `rgb8` (8-bit sRGB) under `metric`, ties broken by
 * the lowest index (REQ-PIX-021). This is the per-color rule every LUT entry follows; it is
 * exported as a reference for tests and CPU paths.
 */
export function nearestPaletteIndex(
  colors: readonly HexColor[],
  rgb8: readonly [number, number, number],
  metric: PaletteMetric,
): number {
  const palette = parsePalette(colors, 'nearestPaletteIndex');
  for (const [i, v] of rgb8.entries())
    assertByte(`nearestPaletteIndex rgb8[${i}]`, v);
  const coords = paletteCoords(palette, metric);
  const q =
    metric === 'oklab'
      ? oklabOf8(rgb8, {L: 0, a: 0, b: 0})
      : {L: rgb8[0], a: rgb8[1], b: rgb8[2]};
  return nearest(coords, q.L, q.a, q.b);
}

/** Palette coordinates in the metric space, packed `[x0, y0, z0, x1, ...]`. */
function paletteCoords(
  palette: readonly [number, number, number][],
  metric: PaletteMetric,
): Float64Array {
  const coords = new Float64Array(palette.length * 3);
  const lab: Oklab = {L: 0, a: 0, b: 0};
  palette.forEach((rgb, i) => {
    if (metric === 'oklab') {
      oklabOf8(rgb, lab);
      coords[i * 3] = lab.L;
      coords[i * 3 + 1] = lab.a;
      coords[i * 3 + 2] = lab.b;
    } else {
      coords[i * 3] = rgb[0];
      coords[i * 3 + 1] = rgb[1];
      coords[i * 3 + 2] = rgb[2];
    }
  });
  return coords;
}

/**
 * Lowest-index nearest entry. The partial-distance early exit is exact: the squared distance
 * is summed in a fixed order of non-negative terms, so a partial sum `>= best` can never
 * become strictly smaller, and only a strictly smaller distance replaces the best.
 */
function nearest(
  coords: Float64Array,
  x: number,
  y: number,
  z: number,
): number {
  let best = 0;
  let bestDist = Infinity;
  const n = coords.length;
  for (let k = 0; k < n; k += 3) {
    const dx = x - (coords[k] as number);
    let d = dx * dx;
    if (d >= bestDist) continue;
    const dy = y - (coords[k + 1] as number);
    d = d + dy * dy;
    if (d >= bestDist) continue;
    const dz = z - (coords[k + 2] as number);
    d = d + dz * dz;
    if (d < bestDist) {
      bestDist = d;
      best = k / 3;
    }
  }
  return best;
}

/** Palette coordinates sorted by the first axis (then index) for the pruned search. */
interface SortedPalette {
  xs: Float64Array;
  ys: Float64Array;
  zs: Float64Array;
  index: Int32Array;
}

function sortPalette(coords: Float64Array): SortedPalette {
  const n = coords.length / 3;
  const order = Array.from({length: n}, (_, i) => i).sort(
    (i, j) => (coords[i * 3] as number) - (coords[j * 3] as number) || i - j,
  );
  const sorted: SortedPalette = {
    xs: new Float64Array(n),
    ys: new Float64Array(n),
    zs: new Float64Array(n),
    index: new Int32Array(n),
  };
  order.forEach((src, k) => {
    sorted.xs[k] = coords[src * 3] as number;
    sorted.ys[k] = coords[src * 3 + 1] as number;
    sorted.zs[k] = coords[src * 3 + 2] as number;
    sorted.index[k] = src;
  });
  return sorted;
}

/**
 * Same result as {@link nearest} (the set-defined argmin, ties to the lowest index), found by
 * walking outwards from `x` along the sorted first axis. A side stops once `dx² > best`: the
 * walk is monotone in `dx²`, and every further candidate has a total `>= dx² > best`, so the
 * pruning is exact (equal totals are never skipped, keeping the tie rule).
 */
function nearestSorted(
  p: SortedPalette,
  x: number,
  y: number,
  z: number,
): number {
  const {xs, ys, zs, index} = p;
  const n = xs.length;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((xs[mid] as number) < x) lo = mid + 1;
    else hi = mid;
  }
  let up = lo;
  let down = lo - 1;
  let best = -1;
  let bestDist = Infinity;
  while (up < n || down >= 0) {
    for (let side = 0; side < 2; side++) {
      const k = side === 0 ? up : down;
      if (k < 0 || k >= n) continue;
      const dx = x - (xs[k] as number);
      let d = dx * dx;
      if (d > bestDist) {
        if (side === 0) up = n;
        else down = -1;
        continue;
      }
      if (side === 0) up++;
      else down--;
      const dy = y - (ys[k] as number);
      d = d + dy * dy;
      if (d > bestDist) continue;
      const dz = z - (zs[k] as number);
      d = d + dz * dz;
      const i = index[k] as number;
      if (d < bestDist || (d === bestDist && i < best)) {
        bestDist = d;
        best = i;
      }
    }
  }
  return best;
}

/**
 * Builds the palette LUT (REQ-PIX-021, A7): a 512×512 RGBA8 texture, row 0 first, tightly
 * packed, uploaded without flip. Entry `(r, g, b)` at {@link lutTexelOffset} holds the nearest
 * palette color to sRGB `(lutLevel(r), lutLevel(g), lutLevel(b))` as 8-bit sRGB in RGB and its
 * palette index in A. Pure and deterministic: the same palette gives the same bytes in every
 * JavaScript engine.
 *
 * Throws `RangeError` for an empty palette, more than 256 colors or a malformed hex color
 * (callers validate settings first, REQ-PIX-019).
 */
export function buildPaletteLut(
  colors: readonly HexColor[],
  metric: PaletteMetric,
): Uint8Array {
  const palette = parsePalette(colors, 'buildPaletteLut');
  const sorted = sortPalette(paletteCoords(palette, metric));
  const lut = new Uint8Array(PALETTE_LUT_BYTES);
  const levels = new Float64Array(PALETTE_LUT_SIZE);
  for (let i = 0; i < PALETTE_LUT_SIZE; i++) {
    const c8 = lutLevel(i);
    levels[i] = metric === 'oklab' ? (SRGB8_TO_LINEAR[c8] as number) : c8;
  }
  const lab: Oklab = {L: 0, a: 0, b: 0};
  for (let b = 0; b < PALETTE_LUT_SIZE; b++) {
    const lb = levels[b] as number;
    for (let g = 0; g < PALETTE_LUT_SIZE; g++) {
      const lg = levels[g] as number;
      let offset = lutTexelOffset(0, g, b);
      for (let r = 0; r < PALETTE_LUT_SIZE; r++) {
        const lr = levels[r] as number;
        let index: number;
        if (metric === 'oklab') {
          linearSrgbToOklab(lr, lg, lb, lab);
          index = nearestSorted(sorted, lab.L, lab.a, lab.b);
        } else {
          index = nearestSorted(sorted, lr, lg, lb);
        }
        const rgb = palette[index] as [number, number, number];
        lut[offset] = rgb[0];
        lut[offset + 1] = rgb[1];
        lut[offset + 2] = rgb[2];
        lut[offset + 3] = index;
        offset += 4;
      }
    }
  }
  return lut;
}

/**
 * CPU reference of the GPU lookup (AC-PIX-021.3): the palette index stored for the 8-bit
 * sRGB color `rgb8` in `lut`. Throws `RangeError` on a wrong-sized LUT or non-byte channel.
 */
export function quantizeReference(
  lut: Uint8Array,
  rgb8: readonly [number, number, number],
): number {
  if (lut.length !== PALETTE_LUT_BYTES) {
    throw new RangeError(
      `quantizeReference: LUT must be ${PALETTE_LUT_BYTES} bytes, got ${lut.length}`,
    );
  }
  const offset = lutTexelOffset(
    lutIndex(rgb8[0]),
    lutIndex(rgb8[1]),
    lutIndex(rgb8[2]),
  );
  return lut[offset + 3] as number;
}

/**
 * The palette entry with the lowest OKLab lightness, ties broken by the lowest index
 * (REQ-PIX-017 `black` outline mode, AC-PIX-017.1/.4). Returns the entry as given. Palette
 * `none` is the caller's case (#000000). Throws `RangeError` for an empty or malformed palette.
 */
export function darkestColor(colors: readonly HexColor[]): HexColor {
  const palette = parsePalette(colors, 'darkestColor');
  const lab: Oklab = {L: 0, a: 0, b: 0};
  let best = 0;
  let bestL = Infinity;
  palette.forEach((rgb, i) => {
    oklabOf8(rgb, lab);
    if (lab.L < bestL) {
      bestL = lab.L;
      best = i;
    }
  });
  return colors[best] as HexColor;
}

/** A request to the palette LUT worker. */
export interface PaletteLutRequest {
  /** Message kind. */
  type: 'build';
  /** Caller-chosen ID echoed in the response. */
  id: number;
  /** Palette colors, `#rrggbb`, 1..256 entries. */
  colors: HexColor[];
  /** Nearest-color metric. */
  metric: PaletteMetric;
}

/** A response from the palette LUT worker. */
export type PaletteLutResponse =
  | {
      /** The LUT was built. */
      type: 'built';
      /** ID of the request. */
      id: number;
      /** The LUT bytes ({@link PALETTE_LUT_BYTES}); its buffer is transferred. */
      lut: Uint8Array;
    }
  | {
      /** The request was rejected. */
      type: 'error';
      /** ID of the request, or -1 when the request had none. */
      id: number;
      /** Reason. */
      message: string;
    };

/** Builds palette LUTs off the main thread (AC-PIX-021.2). */
export interface PaletteLutWorker {
  /**
   * Builds the LUT for `colors` in the worker. Requests run in order. The caller keeps using
   * its previous LUT until the promise resolves (AC-PIX-021.2). Rejects on invalid input or
   * after {@link PaletteLutWorker.dispose}.
   */
  build(
    colors: readonly HexColor[],
    metric: PaletteMetric,
  ): Promise<Uint8Array>;
  /** Terminates the worker and rejects pending builds. Idempotent. */
  dispose(): void;
}

/** Default per-request timeout of {@link createPaletteLutWorker}, in milliseconds. */
export const PALETTE_LUT_WORKER_TIMEOUT_MS = 5000;

/** Options of {@link createPaletteLutWorker}. */
export interface PaletteLutWorkerOptions {
  /**
   * Creates the worker. Required: the engine never constructs a `Worker` from a URL itself
   * (REQ-GEN-014). The host builds it from the bundled worker URL, through its Trusted Types
   * policy (`csg-worker-url`).
   */
  createWorker: () => Worker;
  /** Per-request timeout in ms; a request that gets no response rejects. Default 5000. */
  timeoutMs?: number;
}

interface PendingRequest {
  resolve: (lut: Uint8Array) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Checks a worker response (untrusted `postMessage` data, REQ-GEN-016). Returns `null` for
 * anything that is not a known `type` with a numeric `id`, or a `built` reply whose LUT is not
 * a `Uint8Array` of exactly {@link PALETTE_LUT_BYTES}. Exported for tests.
 */
export function readPaletteLutResponse(
  data: unknown,
): {id: number; lut: Uint8Array | null; message: string} | null {
  if (data === null || typeof data !== 'object') return null;
  const r = data as Record<string, unknown>;
  if (typeof r.id !== 'number') return null;
  if (r.type === 'built') {
    const lut = r.lut;
    if (lut instanceof Uint8Array && lut.byteLength === PALETTE_LUT_BYTES) {
      return {id: r.id, lut, message: ''};
    }
    return null;
  }
  if (r.type === 'error') {
    return {
      id: r.id,
      lut: null,
      message:
        typeof r.message === 'string'
          ? r.message.slice(0, 200)
          : 'palette LUT worker: error',
    };
  }
  return null;
}

/**
 * Wraps a host-created palette LUT worker (`palette-lut.worker.ts`, exported as
 * `@csg/engine/palette-lut.worker`). Every reply is validated (invalid ones are ignored), every request has a timeout,
 * and no promise stays unsettled: pending entries are rejected on timeout, `error`,
 * `messageerror` and dispose.
 */
export function createPaletteLutWorker(
  options: PaletteLutWorkerOptions,
): PaletteLutWorker {
  const worker = options.createWorker();
  const timeoutMs = options.timeoutMs ?? PALETTE_LUT_WORKER_TIMEOUT_MS;
  const pending = new Map<number, PendingRequest>();
  let nextId = 1;
  let disposed = false;

  const settle = (id: number): PendingRequest | undefined => {
    const p = pending.get(id);
    if (p === undefined) return undefined;
    pending.delete(id);
    clearTimeout(p.timer);
    return p;
  };

  const failAll = (error: Error) => {
    for (const id of [...pending.keys()]) settle(id)?.reject(error);
  };

  worker.addEventListener('message', (event: MessageEvent<unknown>) => {
    const res = readPaletteLutResponse(event.data);
    const p = res === null ? undefined : settle(res.id);
    if (res === null || p === undefined) {
      // REQ-GEN-016: ignore invalid or unexpected replies; the request stays pending.
      console.debug('palette LUT worker: ignored an invalid reply');
      return;
    }
    if (res.lut !== null) p.resolve(res.lut);
    else p.reject(new Error(res.message));
  });
  worker.addEventListener('error', () => {
    failAll(new Error('palette LUT worker failed'));
  });
  worker.addEventListener('messageerror', () => {
    failAll(new Error('palette LUT worker: message could not be deserialized'));
  });

  return {
    build(colors, metric) {
      if (disposed) {
        return Promise.reject(new Error('palette LUT worker disposed'));
      }
      const id = nextId++;
      const request: PaletteLutRequest = {
        type: 'build',
        id,
        colors: [...colors],
        metric,
      };
      return new Promise<Uint8Array>((resolve, reject) => {
        const timer = setTimeout(() => {
          settle(id)?.reject(
            new Error(`palette LUT worker timed out after ${timeoutMs} ms`),
          );
        }, timeoutMs);
        pending.set(id, {resolve, reject, timer});
        try {
          worker.postMessage(request);
        } catch (e) {
          settle(id)?.reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      worker.terminate();
      failAll(new Error('palette LUT worker disposed'));
    },
  };
}
