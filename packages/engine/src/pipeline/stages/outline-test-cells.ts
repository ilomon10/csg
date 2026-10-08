/**
 * Test-only builders of hand-made scene MRT cells and a CPU reference of the
 * coverage → edge-detect → outline chain (M2-12). Shared by the Node unit
 * tests and the GPU tests (`test/gpu/outline-stages.gpu.ts`). Not used by the
 * render path.
 */
import {DataUtils} from 'three';
import {referenceEdgeDetect} from './edge-detect';
import type {EdgeDetectParams, MrtCell} from './edge-detect';
import type {OutlineMode} from './outline';

/** Values written into a rectangle of a {@link CellBuilder}. */
export interface CellFill {
  /** Linear RGBA (A = material alpha). */
  readonly color: readonly [number, number, number, number];
  /** View-space normal (default `(0, 0, 1)`). */
  readonly normal?: readonly [number, number, number];
  /** Depth in output px from the pivot plane, + toward the camera (default 0). */
  readonly depth?: number;
  /** Part ID (default 1). */
  readonly id?: number;
}

/** Rounds to the nearest fp16 value (the scene MRT precision). */
export function half(v: number): number {
  return DataUtils.fromHalfFloat(DataUtils.toHalfFloat(v));
}

/** Builds an {@link MrtCell}; every stored value is fp16-exact. */
export class CellBuilder {
  private readonly color: Float32Array;
  private readonly normalDepth: Float32Array;
  private readonly partId: Float32Array;

  /**
   * @param width - Cell width in px.
   * @param height - Cell height in px.
   */
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.color = new Float32Array(width * height * 4);
    this.normalDepth = new Float32Array(width * height * 4);
    this.partId = new Float32Array(width * height);
  }

  /**
   * Fills the inclusive rectangle `[x0, x1] × [y0, y1]` (top-left rows).
   *
   * @returns `this`.
   */
  rect(x0: number, y0: number, x1: number, y1: number, f: CellFill): this {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) this.pixel(x, y, f);
    }
    return this;
  }

  /**
   * Sets one pixel.
   *
   * @returns `this`.
   */
  pixel(x: number, y: number, f: CellFill): this {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return this;
    const i = y * this.width + x;
    const n = f.normal ?? [0, 0, 1];
    for (let c = 0; c < 4; c++) this.color[i * 4 + c] = half(f.color[c] ?? 0);
    for (let c = 0; c < 3; c++) this.normalDepth[i * 4 + c] = half(n[c] ?? 0);
    this.normalDepth[i * 4 + 3] = half(f.depth ?? 0);
    this.partId[i] = half(f.id ?? 1);
    return this;
  }

  /** The built cell (shares the builder's arrays). */
  build(): MrtCell {
    return {
      width: this.width,
      height: this.height,
      color: this.color,
      normalDepth: this.normalDepth,
      partId: this.partId,
    };
  }
}

/** Fills a disc of radius `r` centred on `(cx, cy)` (pixel centres inside). */
export function disc(
  b: CellBuilder,
  cx: number,
  cy: number,
  r: number,
  f: CellFill,
): CellBuilder {
  for (let y = 0; y < b.height; y++) {
    for (let x = 0; x < b.width; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r) b.pixel(x, y, f);
    }
  }
  return b;
}

/** Uniform values of the outline chain besides the edge-detect ones. */
export interface OutlineParams extends EdgeDetectParams {
  readonly mode: OutlineMode;
  readonly darkenAmount: number;
  /** Linear RGB. */
  readonly customColor: readonly [number, number, number];
  /** Linear RGB of `render.paletteDarkest`. */
  readonly black: readonly [number, number, number];
}

/**
 * CPU reference of `alphaCutoff` → `edgeDetect` → `outline` (linear RGBA per
 * pixel, alpha 0 or 1).
 *
 * @param cell - Scene MRT values.
 * @param p - Settings of the three stages.
 * @returns Linear RGBA.
 */
export function referenceOutlineChain(
  cell: MrtCell,
  p: OutlineParams,
): Float32Array {
  const e = referenceEdgeDetect(cell, p);
  const n = cell.width * cell.height;
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const a = cell.color[i * 4 + 3] ?? 0;
    if (e.outer[i] === 1 || e.inner[i] === 1) {
      for (let c = 0; c < 3; c++) {
        out[i * 4 + c] =
          p.mode === 'darken'
            ? (e.source[i * 4 + c] ?? 0) * (1 - p.darkenAmount)
            : p.mode === 'custom'
              ? (p.customColor[c] ?? 0)
              : (p.black[c] ?? 0);
      }
      out[i * 4 + 3] = 1;
    } else if (a >= p.cutoff) {
      for (let c = 0; c < 3; c++) out[i * 4 + c] = cell.color[i * 4 + c] ?? 0;
      out[i * 4 + 3] = 1;
    }
  }
  return out;
}

/** Linear [0, 1] → 8-bit unorm with round-to-nearest (render target store). */
export function toUnorm8(linear: Float32Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(linear.length);
  for (let i = 0; i < linear.length; i++) {
    out[i] = Math.round(Math.min(Math.max(linear[i] ?? 0, 0), 1) * 255);
  }
  return out;
}
