/** File and frame naming (REQ-EXP-012, REQ-EXP-016). Pure. */
import type {DirectionLabel} from '@csg/parts-schema';

/**
 * Direction labels in index order. A copy of parts-schema's `DIRECTION_ORDER`: the export worker
 * imports no parts-schema runtime code (REQ-GEN-015); a unit test keeps the two equal.
 */
export const EXPORT_DIRECTION_ORDER: readonly DirectionLabel[] = [
  'e',
  'ne',
  'n',
  'nw',
  'w',
  'sw',
  's',
  'se',
];

/**
 * Base file name: lowercase, runs of characters outside `[a-z0-9]` become one `-`, trimmed of
 * `-`, at most 64 characters, `character` when empty (REQ-EXP-016).
 *
 * @param input Override or character name.
 * @returns The sanitized base name.
 */
export function sanitizeBaseName(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 64)
    .replace(/-+$/, '');
  return cleaned === '' ? 'character' : cleaned;
}

/**
 * Labels of the active direction set in index order: 8 = all, 4 = `e n w s`, 2 = `e w`, 1 =
 * `singleFacing` (spec 003 REQ-PIX-005). Same rule as the pipeline, without its three.js imports.
 *
 * @param count 1, 2, 4 or 8.
 * @param singleFacing Label used when `count` is 1.
 * @returns The labels, or `null` when `count` is not one of 1, 2, 4, 8.
 */
export function exportDirectionLabels(
  count: number,
  singleFacing: DirectionLabel = 's',
): DirectionLabel[] | null {
  if (count === 1) return [singleFacing];
  if (count !== 2 && count !== 4 && count !== 8) return null;
  const step = 8 / count;
  return EXPORT_DIRECTION_ORDER.filter((_, i) => i % step === 0);
}

/** `<label>_<dir>_<frame>` with the frame zero-padded to 3 digits (REQ-EXP-012). */
export function frameName(label: string, dir: string, frame: number): string {
  return `${label}_${dir}_${String(frame).padStart(3, '0')}`;
}

/** `<label>_<dir>` (REQ-EXP-012). */
export function tagName(label: string, dir: string): string {
  return `${label}_${dir}`;
}

/** `@<s>x` for scales above 1, else the empty string (file name table). */
export function scaleSuffix(scale: number): string {
  return scale > 1 ? `@${scale}x` : '';
}

/** Whether `dir` is a west-facing label made by flipping its east source (`mirrorWest`). */
export function isMirroredLabel(dir: string, mirrorWest: boolean): boolean {
  return mirrorWest && (dir === 'w' || dir === 'nw' || dir === 'sw');
}
