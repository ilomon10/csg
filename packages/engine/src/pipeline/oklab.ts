/**
 * Portable OKLab conversion for the CPU palette path (REQ-PIX-021, amendment A7).
 *
 * Only `+ - * /` and comparisons on IEEE-754 doubles are used, so every JavaScript engine
 * produces the same bits. The cube root is a fixed number of Newton iterations after an exact
 * power-of-two range reduction; `Math.cbrt` and `Math.pow` are not allowed here.
 *
 * Matrices: B. Ottosson, "A perceptual color space for image processing"
 * (https://bottosson.github.io/posts/oklab/).
 *
 * @module
 */

/** Newton iterations of {@link portableCbrt}; fixed so the result never depends on the input. */
export const CBRT_NEWTON_ITERATIONS = 6;

/**
 * Cube root by range reduction plus {@link CBRT_NEWTON_ITERATIONS} Newton steps. Uses only
 * `+ - * /` and comparisons, so it is bit-identical across JavaScript engines. Accurate to a
 * few ulps for finite inputs; `cbrt(0) = 0`, the sign is preserved, NaN and infinities pass
 * through.
 */
export function portableCbrt(x: number): number {
  if (x === 0 || !Number.isFinite(x)) return x;
  const negative = x < 0;
  let m = negative ? -x : x;
  // Exact range reduction: x = m * 8^k with m in [0.125, 1), so cbrt(x) = cbrt(m) * 2^k.
  // Multiplying or dividing by 8 and 2 is exact for every finite double in this range.
  let scale = 1;
  while (m >= 1) {
    m = m / 8;
    scale = scale * 2;
  }
  while (m < 0.125) {
    m = m * 8;
    scale = scale / 2;
  }
  // Linear first guess on [0.125, 1) (max error about 0.06), then quadratically convergent Newton.
  let y = 0.4 + 0.6 * m;
  for (let i = 0; i < CBRT_NEWTON_ITERATIONS; i++) {
    y = (2 * y + m / (y * y)) / 3;
  }
  const r = y * scale;
  return negative ? -r : r;
}

/** An OKLab color: lightness `L` and the opponent axes `a`, `b`. */
export interface Oklab {
  /** Perceived lightness, 0 for black and about 1 for white. */
  L: number;
  /** Green–red axis. */
  a: number;
  /** Blue–yellow axis. */
  b: number;
}

/**
 * Converts linear sRGB to OKLab. Writes into `out` when given (no allocation) and returns it.
 * Deterministic and portable: fixed evaluation order, only basic arithmetic.
 */
export function linearSrgbToOklab(
  r: number,
  g: number,
  b: number,
  out: Oklab = {L: 0, a: 0, b: 0},
): Oklab {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l3 = portableCbrt(l);
  const m3 = portableCbrt(m);
  const s3 = portableCbrt(s);
  out.L = 0.2104542553 * l3 + 0.793617785 * m3 - 0.0040720468 * s3;
  out.a = 1.9779984951 * l3 - 2.428592205 * m3 + 0.4505937099 * s3;
  out.b = 0.0259040371 * l3 + 0.7827717662 * m3 - 0.808675766 * s3;
  return out;
}
