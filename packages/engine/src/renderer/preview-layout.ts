/**
 * Preview upscale (spec 003 REQ-PIX-031, m2-plan 2.1 item 5): the canvas
 * drawing buffer is the cell (W x H), and the host shows it at an integer
 * number of device pixels per sprite pixel with `image-rendering: pixelated`.
 * Pure: no DOM; the host passes `devicePixelRatio`.
 */
import type {PreviewResize} from '../contracts/renderer';

/** A positive finite number, else `fallback`. */
function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Largest integer device scale `k` at which a `cellW` x `cellH` cell fits a
 * viewport of `viewportCssW` x `viewportCssH` CSS pixels at `dpr` device
 * pixels per CSS pixel: `k = floor(min(viewportCssW·dpr / cellW,
 * viewportCssH·dpr / cellH))`, at least 1 (a viewport smaller than the cell
 * overflows rather than dropping below one device pixel per sprite pixel).
 * Each sprite pixel then covers exactly `k x k` device pixels, and the CSS
 * size is `cell · k / dpr` (AC-PIX-031.1).
 *
 * A viewport within 1e-6 device px of a whole multiple counts as fitting
 * (CSS sizes from layout are often fractional, e.g. 383.99999).
 * Invalid inputs (NaN, ≤ 0) fall back to `dpr = 1` and a 1 px viewport.
 *
 * @param cellW Cell width in pixels (integer ≥ 1).
 * @param cellH Cell height in pixels (integer ≥ 1).
 * @param viewportCssW Available width in CSS pixels.
 * @param viewportCssH Available height in CSS pixels.
 * @param dpr Device pixel ratio.
 * @returns The cell, the integer scale and the CSS size.
 */
export function previewLayout(
  cellW: number,
  cellH: number,
  viewportCssW: number,
  viewportCssH: number,
  dpr: number,
): PreviewResize {
  const w = Math.max(1, Math.floor(positive(cellW, 1)));
  const h = Math.max(1, Math.floor(positive(cellH, 1)));
  const ratio = positive(dpr, 1);
  const deviceW = positive(viewportCssW, 1) * ratio;
  const deviceH = positive(viewportCssH, 1) * ratio;
  const EPS = 1e-6;
  const fit = Math.min(
    Math.floor(deviceW / w + EPS),
    Math.floor(deviceH / h + EPS),
  );
  const scale = Math.max(1, fit);
  return {
    cellW: w,
    cellH: h,
    scale,
    cssW: (w * scale) / ratio,
    cssH: (h * scale) / ratio,
  };
}
