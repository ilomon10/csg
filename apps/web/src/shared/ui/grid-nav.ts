/** Keyboard model shared by the roving-tabindex widgets (APG listbox, radiogroup, tabs). */

/** Navigation keys understood by {@link nextIndex}. */
export type NavKey =
  'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

/** Whether `key` is a {@link NavKey}. */
export function isNavKey(key: string): key is NavKey {
  return (
    key === 'ArrowLeft' ||
    key === 'ArrowRight' ||
    key === 'ArrowUp' ||
    key === 'ArrowDown' ||
    key === 'Home' ||
    key === 'End'
  );
}

/** Options for {@link nextIndex}. */
export interface NextIndexOptions {
  /** Number of items. */
  readonly count: number;
  /** Items per row for 2-D grids; 1 (or omitted) means a plain list. */
  readonly columns?: number;
  /** Wrap around at the ends (radiogroups, tabs). Grids stop at the ends. */
  readonly wrap?: boolean;
  /**
   * `grid`: Left/Right by one, Up/Down by a row. `list`: all four arrows step by one (APG
   * radiogroup). `horizontal` / `vertical`: only that axis steps (APG tabs).
   */
  readonly axis?: 'grid' | 'list' | 'horizontal' | 'vertical';
}

/**
 * Computes the index that `key` moves to from `current`, or `null` when the key does not move.
 * Home/End jump to the ends.
 */
export function nextIndex(
  key: NavKey,
  current: number,
  {count, columns = 1, wrap = false, axis = 'grid'}: NextIndexOptions,
): number | null {
  if (count <= 0) return null;
  let target: number;
  switch (key) {
    case 'Home':
      target = 0;
      break;
    case 'End':
      target = count - 1;
      break;
    case 'ArrowRight':
    case 'ArrowLeft':
      if (axis === 'vertical') return null;
      target = current + (key === 'ArrowRight' ? 1 : -1);
      break;
    case 'ArrowDown':
    case 'ArrowUp': {
      if (axis === 'horizontal') return null;
      const step = axis === 'grid' ? columns : 1;
      target = current + (key === 'ArrowDown' ? step : -step);
      break;
    }
  }
  if (wrap) return ((target % count) + count) % count;
  if (target < 0 || target >= count || target === current) return null;
  return target;
}
