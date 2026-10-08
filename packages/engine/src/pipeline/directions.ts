/** Direction helpers (REQ-PIX-005). Yaw math lives in the preview scene. */
import {DIRECTION_ORDER} from '@csg/parts-schema';
import type {DirectionLabel} from '@csg/parts-schema';
import {directionYaw, stageYaw} from '../renderer/preview-scene';

/** Direction counts the pipeline accepts. */
export type DirectionCount = 1 | 2 | 4 | 8;

/**
 * Labels of the active direction set: 8 = all, 4 = `e n w s`, 2 = `e w`,
 * 1 = `singleFacing` (AC-PIX-005.1..005.3).
 *
 * @param count Number of directions.
 * @param singleFacing Label used when `count` is 1.
 * @returns Labels in index order.
 * @throws Error when `count` is not 1, 2, 4 or 8 (validation reports
 *   `PIX_INVALID_DIRECTIONS` before this is reached; AC-PIX-005.4).
 */
export function directionLabels(
  count: number,
  singleFacing: DirectionLabel = 's',
): DirectionLabel[] {
  if (count === 1) return [singleFacing];
  if (count !== 2 && count !== 4 && count !== 8)
    throw new Error(`directionLabels: ${count} directions is not 1, 2, 4 or 8`);
  const step = 8 / count;
  return DIRECTION_ORDER.filter((_, i) => i % step === 0);
}

/** Index of a label in the full 8-direction {@link DIRECTION_ORDER}. */
export function fullIndexOf(label: DirectionLabel): number {
  return DIRECTION_ORDER.indexOf(label);
}

/** Facing yaw in radians of a label: `index * 45°` counter-clockwise from `e`. */
export function facingYawRad(label: DirectionLabel): number {
  return directionYaw(fullIndexOf(label));
}

/** Stage `rotation.y` in radians that makes a +Z-facing model face `label`. */
export function stageYawRad(label: DirectionLabel): number {
  return stageYaw(fullIndexOf(label));
}
