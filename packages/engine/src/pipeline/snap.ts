/** Texel snapping of camera and root translation (REQ-PIX-010, P-05). Pure math. */

/**
 * Rounds to the nearest integer, ties away from zero (2.5 -> 3, -2.5 -> -3).
 * Deterministic; never returns `-0` (AC-PIX-010.3).
 */
export function snapPx(v: number): number {
  // Math.round is correct for the |v| = 0.49999999999999994 edge that floor(|v| + 0.5) gets wrong.
  const r = Math.sign(v) * Math.round(Math.abs(v));
  return r === 0 ? 0 : r;
}

/** Snaps a world-unit value to a whole multiple of `worldPerPx` (ties away from zero). */
export function snapToTexel(world: number, worldPerPx: number): number {
  return snapPx(world / worldPerPx) * worldPerPx;
}

/**
 * Snaps a camera-plane offset (world units) to whole output pixels.
 * Returns the offset in pixels (integers); multiply by `worldPerPx` for world units.
 */
export function snapOffsetPx(
  offsetWorld: readonly [number, number],
  worldPerPx: number,
): [number, number] {
  return [
    snapPx(offsetWorld[0] / worldPerPx),
    snapPx(offsetWorld[1] / worldPerPx),
  ];
}
